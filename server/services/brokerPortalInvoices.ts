import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../db";
import { createBrokerConfirmationService } from "./brokerConfirmationService";
import { BROKER_PAPERWORK_TYPES } from "./brokerConfirmationPresentation";
import { getSignedDownloadUrl, uploadDocumentToS3, deleteFromS3Strict } from "./s3Service";
import { documentSizeMetadata } from "./documentCompression";
import { BrokerPortalError, brokerPortalTransaction, type BrokerIdentity } from "./brokerPortalAuth";

export const portalId = z.coerce.number().int().positive().max(2147483647);
export const portalPage = z.coerce.number().int().positive().max(100000).default(1);
export const portalStatus = z.enum(["all", "pending", "confirmed", "disputed"]).default("all");
export const noteInput = z.object({ message: z.string().trim().min(1).max(2000), parentId: portalId.optional() });
export const uploadType = z.enum(["rate_confirmation", "bill_of_lading", "proof_of_delivery", "other"]);
const invoiceColumns = `i.id,i.invoice_number AS "invoiceNumber",c.name AS "clientName",i.amount::text,
  CASE WHEN i.broker_confirmation_status IN ('confirmed','disputed') THEN i.broker_confirmation_status::text ELSE 'pending' END AS status,
  coalesce(i.submitted_at,i.created_at) AS "submittedAt",
  coalesce(response.created_at,i.broker_confirmed_at) AS "actedAt"`;
const invoiceJoins = `FROM invoices i JOIN clients c ON c.id=i.client_id
  LEFT JOIN LATERAL (SELECT e.created_at,e.actor,e.notes FROM broker_confirmation_events e WHERE e.invoice_id=i.id
   AND e.event IN ('confirmed','disputed') ORDER BY e.created_at DESC,e.id DESC LIMIT 1) response ON true`;
export async function ownBrokerInvoice(actor: BrokerIdentity, id: number) {
  const result = await pool.query("SELECT id FROM invoices WHERE id=$1 AND broker_id=$2", [id, actor.brokerId]);
  if (!result.rowCount) throw new BrokerPortalError(404, "Invoice not found.");
}
export async function listBrokerInvoices(actor: BrokerIdentity, raw: { page?: unknown; status?: unknown }) {
  const page = portalPage.parse(raw.page), status = portalStatus.parse(raw.status);
  const statusFilter = status === "all" ? "" : status === "pending" ?
    "AND i.broker_confirmation_status NOT IN ('confirmed','disputed')" : "AND i.broker_confirmation_status::text=$2";
  const params: unknown[] = [actor.brokerId];
  if (status === "confirmed" || status === "disputed") params.push(status);
  const total = await pool.query(`SELECT count(*)::int AS n FROM invoices i WHERE i.broker_id=$1 ${statusFilter}`, params);
  const rows = await pool.query(`SELECT ${invoiceColumns} ${invoiceJoins} WHERE i.broker_id=$1 ${statusFilter}
    ORDER BY coalesce(i.submitted_at,i.created_at) DESC NULLS LAST,i.id DESC LIMIT 15 OFFSET $${params.length + 1}`, [...params, (page - 1) * 15]);
  return { invoices: rows.rows, total: total.rows[0].n, page, pageSize: 15 };
}
export async function getBrokerInvoice(actor: BrokerIdentity, id: number) {
  const result = await pool.query(`SELECT ${invoiceColumns},i.carrier_invoice_number AS "carrierInvoiceNumber",i.load_number AS "loadNumber",
    coalesce(i.pickup_location,l.pickup_location) AS origin,coalesce(i.delivery_location,l.delivery_location) AS destination,
    CASE WHEN i.broker_confirmation_status='disputed' THEN response.notes ELSE null END AS "disputeReason",
    response.actor AS "actedBy", i.funded_at IS NOT NULL AND i.broker_confirmation_status NOT IN ('confirmed','disputed') AS "canRespond",
    CASE WHEN i.broker_confirmation_status IN ('confirmed','disputed') THEN 'A response has already been recorded. First response wins.'
      WHEN i.funded_at IS NULL THEN 'This invoice is not yet available for confirmation. Responses open after funding.' ELSE null END AS "responseNotice"
    ${invoiceJoins} LEFT JOIN loads l ON l.id=i.load_id WHERE i.id=$1 AND i.broker_id=$2`, [id, actor.brokerId]);
  if (!result.rows[0]) throw new BrokerPortalError(404, "Invoice not found.");
  return result.rows[0];
}
export async function respondToBrokerInvoice(actor: BrokerIdentity, id: number, status: "confirmed" | "disputed", reason = "") {
  if (status === "disputed") reason = z.string().trim().min(1, "Enter a dispute reason.").max(2000).parse(reason);
  return db.transaction(async tx => {
    // Hold ownership and response locks until the unchanged email service
    // finishes its nested transaction. A reassignment cannot race this check.
    const found = await tx.execute(sql`SELECT id FROM invoices WHERE id=${id} AND broker_id=${actor.brokerId} FOR UPDATE`);
    if (!found.rows.length) throw new BrokerPortalError(404, "Invoice not found.");
    return createBrokerConfirmationService({ store: tx }).resolve(id, status,
      { kind: "broker", id: `${actor.contactName} <${actor.email}> [portal:${actor.id}; broker:${actor.brokerId}]` }, reason);
  });
}
export async function listBrokerDocuments(actor: BrokerIdentity, id: number) {
  await ownBrokerInvoice(actor, id);
  const result = await pool.query(`SELECT id,original_name AS name,document_type AS type,size,created_at AS "createdAt"
    FROM documents WHERE invoice_id=$1 AND document_type=ANY($2::varchar[])
    AND EXISTS(SELECT 1 FROM invoices i WHERE i.id=documents.invoice_id AND i.broker_id=$3) ORDER BY id DESC LIMIT 100`,
  [id, [...BROKER_PAPERWORK_TYPES], actor.brokerId]);
  return { documents: result.rows.map(row => ({ ...row, downloadUrl: `/api/broker/invoices/${id}/documents/${row.id}/download` })) };
}
export async function brokerDocumentUrl(actor: BrokerIdentity, id: number, documentId: number, sign = getSignedDownloadUrl) {
  const result = await pool.query(`SELECT d.s3_key,d.storage_key,d.original_name FROM documents d JOIN invoices i ON i.id=d.invoice_id
    WHERE d.id=$1 AND i.id=$2 AND i.broker_id=$3 AND d.document_type=ANY($4::varchar[])`,
  [documentId, id, actor.brokerId, [...BROKER_PAPERWORK_TYPES]]);
  const row = result.rows[0], key = row?.s3_key || row?.storage_key;
  if (!key) throw new BrokerPortalError(404, "Document not found.");
  const filename = String(row.original_name).replace(/[\r\n"\\]/g, "_").slice(0, 180);
  return sign(key, filename, 60);
}
async function compensateUpload(key: string) {
  // Never delete an object if a successful-but-uncertain commit retained it.
  const linked = await pool.query("SELECT id FROM documents WHERE s3_key=$1 OR storage_key=$1 LIMIT 1", [key]);
  if (linked.rowCount) return;
  try { await deleteFromS3Strict(key); }
  catch {
    await pool.query(`INSERT INTO s3_cleanup_queue(s3_key,reason,last_error) VALUES($1,'Broker portal upload compensation','S3_DELETE_FAILED')
      ON CONFLICT(s3_key) DO UPDATE SET updated_at=now(),resolved_at=null`, [key]);
  }
}
export function validBrokerUpload(file: Express.Multer.File) {
  const b = file.buffer;
  const mime = b.subarray(0, 5).toString() === "%PDF-" ? "application/pdf" :
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" :
      b[0] === 255 && b[1] === 216 && b[2] === 255 ? "image/jpeg" : null;
  if (!mime || mime !== file.mimetype || !b.length || b.length > 15 * 1024 * 1024)
    throw new BrokerPortalError(400, "Upload a valid PDF, JPEG, or PNG up to 15 MB.");
  file.originalname = file.originalname.replace(/[\u0000-\u001f\u007f/\\"]/g, "_").slice(0, 180) || "document";
}
export async function uploadBrokerDocument(actor: BrokerIdentity, id: number, rawType: unknown, file: Express.Multer.File,
  effects = { upload: uploadDocumentToS3, compensate: compensateUpload }) {
  const type = uploadType.parse(rawType);
  validBrokerUpload(file);
  const sourceSha = createHash("sha256").update(file.buffer).digest("hex");
  let uploadedKey: string | undefined;
  try {
    return await brokerPortalTransaction(async client => {
      const invoice = await client.query("SELECT id,client_id FROM invoices WHERE id=$1 AND broker_id=$2 FOR UPDATE", [id, actor.brokerId]);
      if (!invoice.rows[0]) throw new BrokerPortalError(404, "Invoice not found.");
      const count = await client.query("SELECT count(*)::int AS n FROM documents WHERE invoice_id=$1", [id]);
      if (count.rows[0].n >= 100) throw new BrokerPortalError(409, "This invoice has reached its document limit. Contact Trucking Pros Financial.");
      const key = `broker-portal/${actor.brokerId}/${id}/${randomUUID()}`;
      uploadedKey = await effects.upload(file, key);
      const sizes = documentSizeMetadata(file);
      const result = await client.query(`INSERT INTO documents(filename,original_name,mime_type,size,original_size,compressed_size,source_sha256,
        storage_key,s3_key,document_type,load_id,invoice_id,client_id,uploaded_by,uploaded_by_broker_portal_user_id,source_channel,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::text,$8::text,$9,NULL,$10,$11,NULL,$12,'portal','processed') RETURNING id`,
      [key.split("/").at(-1), file.originalname, file.mimetype, file.size, sizes.originalSize, sizes.compressedSize, sourceSha,
        key, type, id, invoice.rows[0].client_id, actor.id]);
      await client.query(`INSERT INTO event_ledger(entity_type,entity_id,event_type,actor_type,payload_json)
        VALUES('invoice',$1,'broker_portal_document_uploaded','system',$2::jsonb)`,
      [id, JSON.stringify({ label: "Broker uploaded supporting document", documentId: result.rows[0].id, brokerPortalUserId: actor.id,
        brokerId: actor.brokerId, actor: `${actor.contactName} <${actor.email}>`, documentType: type })]);
      return { id: result.rows[0].id, message: "Document uploaded." };
    });
  } catch (error) {
    if (uploadedKey) {
      try { await effects.compensate(uploadedKey); }
      catch { console.error("[brokerPortal] Upload compensation requires attention."); }
    }
    throw error;
  }
}
export async function brokerNotes(id: number, pageInput: unknown, brokerId?: number) {
  const page = portalPage.parse(pageInput);
  const scope = "invoice_id=$1 AND ($2::integer IS NULL OR EXISTS(SELECT 1 FROM invoices i WHERE i.id=invoice_id AND i.broker_id=$2))";
  const total = await pool.query(`SELECT count(*)::int AS n FROM broker_portal_notes WHERE ${scope}`, [id, brokerId ?? null]);
  const result = await pool.query(`SELECT id,parent_id AS "parentId",author_name AS "authorName",message,created_at AS "createdAt",
    CASE WHEN portal_user_id IS NOT NULL THEN 'broker' ELSE 'staff' END AS "authorKind" FROM broker_portal_notes
    WHERE ${scope} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $3`, [id, brokerId ?? null, (page - 1) * 25]);
  return { notes: result.rows, total: total.rows[0].n, page, pageSize: 25 };
}
export async function addBrokerNote(id: number, input: unknown, actor: { name: string; brokerUserId?: number; brokerId?: number; staffUserId?: string }) {
  const value = noteInput.parse(input);
  return brokerPortalTransaction(async client => {
    const owned = await client.query("SELECT id FROM invoices WHERE id=$1 AND ($2::integer IS NULL OR broker_id=$2) FOR UPDATE", [id, actor.brokerId ?? null]);
    if (!owned.rowCount) throw new BrokerPortalError(404, "Invoice not found.");
    if (value.parentId) {
      const parent = await client.query("SELECT id FROM broker_portal_notes WHERE id=$1 AND invoice_id=$2", [value.parentId, id]);
      if (!parent.rowCount) throw new BrokerPortalError(400, "Reply must belong to this invoice.");
    }
    const result = await client.query(`INSERT INTO broker_portal_notes(invoice_id,parent_id,portal_user_id,staff_user_id,author_name,message)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [id, value.parentId ?? null, actor.brokerUserId ?? null, actor.staffUserId ?? null, actor.name.slice(0, 200), value.message]);
    await client.query(`INSERT INTO event_ledger(entity_type,entity_id,event_type,actor_type,actor_id,payload_json)
      VALUES('invoice',$1,'broker_portal_note_added',$2,$3,$4::jsonb)`, [id, actor.staffUserId ? "user" : "system", actor.staffUserId ?? null,
      JSON.stringify({ label: actor.staffUserId ? "Staff replied to broker" : "Broker added a note", noteId: result.rows[0].id,
        brokerPortalUserId: actor.brokerUserId ?? null, actor: actor.name })]);
    return { id: result.rows[0].id, message: "Note posted." };
  });
}

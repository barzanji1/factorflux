import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  carrierPortalUsers, carrierSubmissions, carrierSubmissionDocs, carrierSubmissionAlertAcks, carrierSubmissionPreflightEvents,
  brokers, brokerBranches, clients, clientVault,
} from "../../shared/schema";
import { LOAD_TYPES } from "../../shared/load-types";
import { db, pool } from "../db";
import type { ClientIdentity } from "./clientApiAuth";
import { ClientApiError, clientPage, clientTransaction } from "./clientApiCommon";
import { ownedClientSubmission } from "./clientFunding";
import { uploadDocumentToS3, deleteFromS3Strict, getSignedDownloadUrl } from "./s3Service";
import { documentSizeMetadata } from "./documentCompression";

export interface ClientIntakeChecks {
  preflight: (input: any, tx: any) => Promise<{ alerts: any[] }>;
  nearAlerts: (input: any, tx: any) => Promise<any[]>;
  decide: (alerts: any[], acknowledgements: any, user: any, override: boolean) => {
    accepted: boolean; invalidAcknowledgements?: boolean; acknowledgements: any[];
  };
}
const submissionInput = z.object({
  loadNumber: z.string().trim().min(1).max(100), invoiceNumber: z.string().trim().min(1).max(100),
  loadType: z.enum(LOAD_TYPES), brokerId: z.coerce.number().int().positive(), branchId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(100), lumper: z.enum(["yes", "no"]), driverName: z.string().trim().min(1).max(160),
  bankAccountId: z.coerce.number().int().positive(), amount: z.coerce.number().positive().max(9999999999.99).refine(v => /^\d+(\.\d{1,2})?$/.test(String(v)), "Use at most two decimal places."),
  paymentType: z.enum(["ACH", "wire"]), instructionsSubject: z.string().trim().max(250).optional(),
  instructionsDetails: z.string().trim().max(4000).optional(),
  acknowledgements: z.array(z.object({ code: z.string().max(120), reason: z.string().max(2000).optional() })).max(100).default([]),
}).strict();
const documentType = z.enum(["rate_confirmation", "bol", "lumper_receipt", "other"]);
const PUBLIC_FIELDS = `id,invoice_number AS "invoiceNumber",load_number AS "loadNumber",broker_name AS "brokerName",
 amount,status,submitted_at AS "submittedAt",funding_status AS "fundingStatus",step_1_received_at AS "step1ReceivedAt",
 step_2_reviewed_at AS "step2ReviewedAt",step_3_funded_at AS "step3FundedAt"`;
export async function clientSubmissionPage(user: ClientIdentity, pageValue: unknown) {
  const page = clientPage(pageValue);
  const [items, total] = await Promise.all([
    pool.query(`SELECT ${PUBLIC_FIELDS} FROM carrier_submissions WHERE portal_user_id=$1 AND carrier_id=$3 ORDER BY id DESC LIMIT 15 OFFSET $2`, [user.id, page.offset, user.carrierId]),
    pool.query("SELECT count(*)::int AS n FROM carrier_submissions WHERE portal_user_id=$1 AND carrier_id=$2", [user.id, user.carrierId]),
  ]);
  return { items: items.rows, total: total.rows[0].n, page: page.page, pageSize: 15 };
}
export async function clientSubmissionDetail(user: ClientIdentity, id: number) {
  const row = (await pool.query(`SELECT ${PUBLIC_FIELDS},load_type AS "loadType",broker_id AS "brokerId",
    branch_id AS "branchId",branch_name AS "branchName",code,lumper,driver_name AS "driverName",
    bank_account_id AS "bankAccountId",payment_type AS "paymentType",instructions_subject AS "instructionsSubject",
    instructions_details AS "instructionsDetails",created_at AS "createdAt"
    FROM carrier_submissions WHERE id=$1 AND portal_user_id=$2 AND carrier_id=$3`, [id, user.id, user.carrierId])).rows[0];
  if (!row) throw new ClientApiError(404, "Submission not found.");
  return row;
}
export async function clientDashboard(user: ClientIdentity) {
  return (await pool.query(`WITH scope AS (SELECT * FROM carrier_submissions WHERE portal_user_id=$1 AND carrier_id=$2),
    payments AS (SELECT DISTINCT i.id,p.net_payout FROM scope s
      JOIN invoices i ON i.id=s.funding_invoice_id AND i.client_id=s.carrier_id JOIN payouts p ON p.invoice_id=i.id
      WHERE s.funding_status='funded' AND i.funded_at IS NOT NULL AND p.advance_paid_at IS NOT NULL AND p.advance_paid_by IS NOT NULL
      AND p.payment_status IN ('advance_paid','reserve_pending','reserve_released','complete')
      AND p.advance_paid_at >= date_trunc('week',now() AT TIME ZONE 'UTC'))
    SELECT (SELECT count(*)::int FROM scope WHERE funding_status<>'funded' AND status<>'rejected') AS "activeSubmissionCount",
      (SELECT count(*)::int FROM scope WHERE funding_status='received' AND status<>'rejected') AS "pendingReviewCount",
      (SELECT count(*)::int FROM payments) AS "fundedThisWeekCount",
      (SELECT COALESCE(sum(net_payout),0)::numeric(14,2)::text FROM payments) AS "fundedThisWeekTotal",
      date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "weekStartsAt"`, [user.id, user.carrierId])).rows[0];
}

export async function clientDocumentPage(user: ClientIdentity, id: number, pageValue: unknown) {
  await ownedClientSubmission(user, id); const page = clientPage(pageValue);
  const [items, total] = await Promise.all([
    pool.query(`SELECT id,document_type AS "documentType",original_name AS "originalName",mime_type AS "mimeType",
      size,original_size AS "originalSize",compressed_size AS "compressedSize",uploaded_at AS "uploadedAt"
      FROM carrier_submission_documents WHERE submission_id=$1 ORDER BY id DESC LIMIT 15 OFFSET $2`, [id, page.offset]),
    pool.query("SELECT count(*)::int AS n FROM carrier_submission_documents WHERE submission_id=$1", [id]),
  ]);
  return { items: items.rows, total: total.rows[0].n, page: page.page, pageSize: 15 };
}
export async function clientDocumentDownload(user: ClientIdentity, submissionId: number, documentId: number) {
  const row = (await pool.query(`SELECT d.s3_key,d.original_name FROM carrier_submission_documents d
    JOIN carrier_submissions s ON s.id=d.submission_id WHERE d.id=$1 AND s.id=$2 AND s.portal_user_id=$3 AND s.carrier_id=$4`,
  [documentId, submissionId, user.id, user.carrierId])).rows[0];
  if (!row?.s3_key) throw new ClientApiError(404, "Document not found.");
  return { url: await getSignedDownloadUrl(row.s3_key, row.original_name), expiresIn: 3600 };
}
interface UploadedClientDocument { key: string; type: z.infer<typeof documentType>; file: Express.Multer.File }
function validateFile(file: Express.Multer.File) {
  const b = file.buffer;
  const valid = file.mimetype === "application/pdf" ? b.subarray(0, 5).toString() === "%PDF-"
    : file.mimetype === "image/png" ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : file.mimetype === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : file.mimetype === "image/tiff" ? ["49492a00", "4d4d002a"].includes(b.subarray(0, 4).toString("hex"))
    : ["image/heic", "image/heif"].includes(file.mimetype) ? b.subarray(4, 8).toString() === "ftyp" : false;
  if (!valid) throw new ClientApiError(400, "Upload valid PDF, JPEG, PNG, TIFF or HEIC documents.");
}
async function prepareUploads(user: ClientIdentity, files: Express.Multer.File[], types: unknown): Promise<UploadedClientDocument[]> {
  if (files.reduce((total, file) => total + file.size, 0) > 40 * 1024 * 1024) throw new ClientApiError(413, "Combined documents exceed 40 MB.");
  const parsedTypes = z.array(documentType).max(6).parse(types);
  if (parsedTypes.length !== files.length) throw new ClientApiError(400, "Supply one documentTypes entry for every uploaded document.");
  files.forEach(validateFile);
  const uploaded: UploadedClientDocument[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const key = `portal/client-api/${user.id}/${randomUUID()}`;
      await pool.query("INSERT INTO client_upload_intents(s3_key,portal_user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [key, user.id]);
      uploaded.push({ key, type: parsedTypes[i], file: files[i] });
      await uploadDocumentToS3(files[i], key);
    }
    return uploaded;
  } catch (error) { await compensateUploads(uploaded); throw error; }
}
async function compensateUploads(uploaded: UploadedClientDocument[]) {
  for (const { key } of uploaded) {
    try {
      // An interrupted COMMIT may actually have succeeded. Never delete a
      // committed document; the durable intent handles unavailable databases.
      const ref = await pool.query("SELECT 1 FROM carrier_submission_documents WHERE s3_key=$1 LIMIT 1", [key]);
      if (!ref.rowCount) await deleteFromS3Strict(key);
      await pool.query("DELETE FROM client_upload_intents WHERE s3_key=$1", [key]);
    } catch { /* Persisted intent is retried after expiry; no raw S3 data in logs. */ }
  }
}
async function commitDocuments(tx: any, user: ClientIdentity, id: number, docs: UploadedClientDocument[]) {
  for (const doc of docs) {
    // Lock/consume the unexpired intent before inserting document rows. A
    // cleanup worker cannot delete an object while its row is being committed.
    const intent = await tx.execute(sql`DELETE FROM client_upload_intents WHERE s3_key=${doc.key}
      AND portal_user_id=${user.id} AND expires_at>clock_timestamp() RETURNING s3_key`);
    if (!intent.rowCount) throw new ClientApiError(409, "Upload expired before submission. Please upload again.");
    await tx.insert(carrierSubmissionDocs).values({
      submissionId: id, documentType: doc.type, filename: doc.key.split("/").at(-1)!,
      originalName: doc.file.originalname.replace(/[/\\\x00-\x1f]/g, "_").slice(0, 200), mimeType: doc.file.mimetype,
      size: doc.file.size, ...documentSizeMetadata(doc.file), s3Key: doc.key,
    });
  }
}
export async function createClientSubmission(user: ClientIdentity, input: unknown, files: Express.Multer.File[], types: unknown, checks: ClientIntakeChecks) {
  const data = submissionInput.parse(input);
  const current = (await db.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.id, user.id)).limit(1))[0];
  if (!current || current.status !== "active" || current.carrierId !== user.carrierId) throw new ClientApiError(403, "Carrier access changed.");
  const uploads = await prepareUploads(user, files, types);
  try {
    const id = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92734012)`);
      const [account] = await tx.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.id, user.id)).for("update").limit(1);
      if (!account || account.status !== "active" || account.carrierId !== user.carrierId) throw new ClientApiError(403, "Carrier access changed.");
      const [[carrier], [broker], [branch], [bank]] = await Promise.all([
        tx.select().from(clients).where(eq(clients.id, user.carrierId)).limit(1),
        tx.select().from(brokers).where(and(eq(brokers.id, data.brokerId), eq(brokers.status, "active"))).limit(1),
        tx.select().from(brokerBranches).where(and(eq(brokerBranches.id, data.branchId), eq(brokerBranches.brokerId, data.brokerId), eq(brokerBranches.status, "active"))).limit(1),
        tx.select().from(clientVault).where(and(eq(clientVault.id, data.bankAccountId), eq(clientVault.clientId, user.carrierId), eq(clientVault.dataType, "bank_account"), eq(clientVault.isActive, true))).limit(1),
      ]);
      if (!carrier || !broker || !branch || !bank) throw new ClientApiError(400, "Select valid carrier, broker, branch and bank account records.");
      const preflightInput = { carrierId: user.carrierId, brokerId: data.brokerId, invoiceNumber: data.invoiceNumber, loadNumber: data.loadNumber, amount: data.amount, serviceDate: new Date() };
      const base = await checks.preflight(preflightInput, tx), near = await checks.nearAlerts(preflightInput, tx);
      const alerts = [...base.alerts, ...near], decision = checks.decide(alerts, data.acknowledgements, { id: user.id, email: user.email, companyName: user.companyName }, false);
      if (!decision.accepted || decision.invalidAcknowledgements) throw new ClientApiError(409, "Review current submission preflight alerts.", { alerts });
      const duplicate = await tx.execute(sql`SELECT id FROM carrier_submissions WHERE carrier_id=${user.carrierId}
        AND status<>'rejected' AND (invoice_number=${data.invoiceNumber} OR load_number=${data.loadNumber}) LIMIT 1`);
      const duplicateInvoice = await tx.execute(sql`SELECT id FROM invoices WHERE client_id=${user.carrierId}
        AND (carrier_invoice_number=${data.invoiceNumber} OR load_number=${data.loadNumber}) LIMIT 1`);
      if (duplicate.rowCount || duplicateInvoice.rowCount) throw new ClientApiError(409, "This invoice or load has already been submitted.");
      const [sub] = await tx.insert(carrierSubmissions).values({
        portalUserId: user.id, carrierId: user.carrierId, invoiceNumber: data.invoiceNumber, loadNumber: data.loadNumber,
        loadType: data.loadType, brokerId: broker.id, brokerName: broker.name, branchId: branch.id, branchName: branch.branchName,
        code: data.code, lumper: data.lumper === "yes", driverName: data.driverName, bankAccountId: bank.id,
        amount: data.amount.toFixed(2), paymentType: data.paymentType, instructionsSubject: data.instructionsSubject,
        instructionsDetails: data.instructionsDetails, status: "submitted", fundingStatus: "received", step1ReceivedAt: new Date(),
      }).returning({ id: carrierSubmissions.id });
      await commitDocuments(tx, user, sub.id, uploads);
      if (decision.acknowledgements.length) await tx.insert(carrierSubmissionAlertAcks).values(decision.acknowledgements.map(ack => ({
        submissionId: sub.id, portalUserId: user.id, alertCode: ack.code, reason: ack.reason || null,
      })));
      await tx.insert(carrierSubmissionPreflightEvents).values({
        submissionId: sub.id, eventType: "invoice_preflight", alerts, acknowledgements: decision.acknowledgements, portalUserId: user.id,
      });
      return sub.id;
    });
    return clientSubmissionDetail(user, id);
  } catch (error) { await compensateUploads(uploads); throw error; }
}
export async function addClientDocuments(user: ClientIdentity, id: number, files: Express.Multer.File[], types: unknown) {
  await ownedClientSubmission(user, id);
  if (!files.length) throw new ClientApiError(400, "Choose at least one document.");
  const uploads = await prepareUploads(user, files, types);
  try {
    await db.transaction(async tx => {
      const [sub] = await tx.select().from(carrierSubmissions).where(and(eq(carrierSubmissions.id, id), eq(carrierSubmissions.portalUserId, user.id))).for("update").limit(1);
      if (!sub || sub.carrierId !== user.carrierId) throw new ClientApiError(404, "Submission not found.");
      if (sub.fundingStatus === "funded") throw new ClientApiError(409, "Documents for funded submissions cannot be changed.");
      await commitDocuments(tx, user, id, uploads);
    });
    return clientDocumentPage(user, id, 1);
  } catch (error) { await compensateUploads(uploads); throw error; }
}
export async function cleanupExpiredClientUpload() {
  return clientTransaction(async tx => {
    const row = (await tx.query("SELECT s3_key FROM client_upload_intents WHERE expires_at<now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if (!row) return;
    if (!(await tx.query("SELECT 1 FROM carrier_submission_documents WHERE s3_key=$1 LIMIT 1", [row.s3_key])).rowCount) {
      try { await deleteFromS3Strict(row.s3_key); }
      catch { await tx.query("UPDATE client_upload_intents SET expires_at=now()+interval '1 hour' WHERE s3_key=$1", [row.s3_key]); return; }
    }
    await tx.query("DELETE FROM client_upload_intents WHERE s3_key=$1", [row.s3_key]);
  });
}

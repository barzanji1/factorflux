import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db";
import { FUNDING_STEPS, type ClientFundingProgress } from "../../shared/client-funding";
import { ClientApiError, clientTransaction, clientPage, iso } from "./clientApiCommon";

export async function ownedClientSubmission(user: { id: number; carrierId: number }, submissionId: number, tx: Pick<PoolClient, "query"> = pool) {
  const row = (await tx.query("SELECT * FROM carrier_submissions WHERE id=$1 AND portal_user_id=$2 AND carrier_id=$3", [submissionId, user.id, user.carrierId])).rows[0];
  if (!row) throw new ClientApiError(404, "Submission not found.");
  return row;
}
// Identity matching is deliberately conservative: never use an internal INV
// number as a carrier invoice reference, or match a different carrier's load.
async function invoiceForSubmission(sub: any, tx: Pick<PoolClient, "query"> = pool) {
  if (!sub.carrier_id) return null;
  const matches = (await tx.query(`SELECT i.id,p.net_payout AS amount,p.advance_paid_at AS paid_at,
    (i.funded_at IS NOT NULL AND p.advance_paid_at IS NOT NULL AND p.advance_paid_by IS NOT NULL
      AND p.payment_status IN ('advance_paid','reserve_pending','reserve_released','complete')) AS verified
    FROM invoices i LEFT JOIN payouts p ON p.invoice_id=i.id
    WHERE i.client_id=$1 AND
      (($2::int IS NOT NULL AND i.id=$2) OR ($2::int IS NULL
        AND ($3::text IS NOT NULL OR $4::text IS NOT NULL)
        AND ($3::text IS NULL OR i.carrier_invoice_number=$3)
        AND ($4::text IS NULL OR i.load_number=$4)
        AND ($5::int IS NULL OR i.broker_id=$5)))
    ORDER BY i.id LIMIT 2`, [sub.carrier_id, sub.funding_invoice_id, sub.invoice_number || null, sub.load_number || null, sub.broker_id])).rows;
  return matches.length === 1 ? matches[0] : null;
}
export async function clientFundingProgress(submissionId: number, canUpdate: boolean): Promise<ClientFundingProgress> {
  const sub = (await pool.query("SELECT * FROM carrier_submissions WHERE id=$1", [submissionId])).rows[0];
  if (!sub) throw new ClientApiError(404, "Submission not found.");
  const [invoice, history] = await Promise.all([invoiceForSubmission(sub), pool.query(`SELECT id,from_status AS "from",to_status AS "to",reason,
    actor_name AS "actorName",changed_at AS "changedAt" FROM client_funding_events WHERE submission_id=$1 ORDER BY id DESC LIMIT 50`, [submissionId])]);
  return {
    submissionId, invoiceId: invoice?.id ?? null, number: sub.invoice_number || String(sub.id),
    fundingStatus: sub.funding_status, step1ReceivedAt: iso(sub.step_1_received_at)!,
    step2ReviewedAt: iso(sub.step_2_reviewed_at), step3FundedAt: iso(sub.step_3_funded_at), stepChangedBy: sub.step_changed_by,
    fundingVerified: !!invoice?.verified, verifiedFundedAt: invoice?.verified ? iso(invoice.paid_at) : null,
    fundedAmount: invoice?.verified ? invoice.amount : null, canUpdate,
    history: history.rows.map(h => ({ ...h, changedAt: iso(h.changedAt)! })),
  };
}
export async function clientSubmissionForInvoice(invoiceId: number): Promise<number | null> {
  const invoice = (await pool.query("SELECT id,client_id,carrier_invoice_number,load_number,broker_id FROM invoices WHERE id=$1", [invoiceId])).rows[0];
  if (!invoice) throw new ClientApiError(404, "Invoice not found.");
  const matches = (await pool.query(`SELECT id FROM carrier_submissions s WHERE s.carrier_id=$1 AND
    (s.funding_invoice_id=$2 OR (s.funding_invoice_id IS NULL
      AND (NULLIF(s.invoice_number,'') IS NOT NULL OR NULLIF(s.load_number,'') IS NOT NULL)
      AND (NULLIF(s.invoice_number,'') IS NULL OR s.invoice_number=$3)
      AND (NULLIF(s.load_number,'') IS NULL OR s.load_number=$4)
      AND (s.broker_id IS NULL OR s.broker_id=$5)))
    ORDER BY id LIMIT 2`, [invoice.client_id, invoice.id, invoice.carrier_invoice_number, invoice.load_number, invoice.broker_id])).rows;
  return matches.length === 1 ? matches[0].id : null;
}
export async function queueClientPush(tx: PoolClient, userId: number, submissionId: number, eventKey: string, body: string) {
  await tx.query(`INSERT INTO client_push_deliveries(dedupe_key,portal_user_id,submission_id,token_id,title,body)
    SELECT $3||'/'||t.id,$1,$2,t.id,'Trucking Pros Financial',$4 FROM client_push_tokens t
    WHERE t.portal_user_id=$1 AND t.active ON CONFLICT(dedupe_key) DO NOTHING`, [userId, submissionId, eventKey, body]);
}
const stepChange = z.object({
  fundingStatus: z.enum(FUNDING_STEPS), expectedStatus: z.enum(FUNDING_STEPS),
  reason: z.string().trim().max(1000).optional(),
}).strict();
export async function changeClientFundingStep(submissionId: number, actorId: string, input: unknown) {
  const data = stepChange.parse(input);
  await clientTransaction(async tx => {
    const actor = (await tx.query("SELECT id,role,status,concat_ws(' ',first_name,last_name) AS name FROM users WHERE id=$1", [actorId])).rows[0];
    if (!actor || actor.status !== "active" || !["admin", "manager", "employee"].includes(actor.role)) throw new ClientApiError(403, "Active staff access required.");
    const sub = (await tx.query("SELECT * FROM carrier_submissions WHERE id=$1 FOR UPDATE", [submissionId])).rows[0];
    if (!sub) throw new ClientApiError(404, "Submission not found.");
    if (sub.funding_status !== data.expectedStatus) throw new ClientApiError(409, "Funding progress changed. Refresh before trying again.");
    const previous = FUNDING_STEPS.indexOf(sub.funding_status), next = FUNDING_STEPS.indexOf(data.fundingStatus);
    if (previous === next) return;
    if (next > previous + 1) throw new ClientApiError(409, "Move through each funding step in order.");
    if (next < previous && (!data.reason || data.reason.length < 5)) throw new ClientApiError(400, "A reason of at least five characters is required to revert.");
    let invoice = await invoiceForSubmission(sub, tx);
    if (data.fundingStatus === "funded") {
      if (!invoice) throw new ClientApiError(409, "No unique matching invoice is linked to this submission.");
      // Match the financial workflow's invoice → payout lock order. A tracker
      // action cannot race an in-progress funding update or create a payout.
      await tx.query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE", [invoice.id]);
      await tx.query("SELECT id FROM payouts WHERE invoice_id=$1 FOR UPDATE", [invoice.id]);
      const verified = await invoiceForSubmission(sub, tx);
      if (!verified?.verified) throw new ClientApiError(409, "Funding must be completed and verified in the financial workflow first.");
      invoice = verified;
    }
    const updated = await tx.query(`UPDATE carrier_submissions SET funding_status=$2::text::client_funding_status,
      step_2_reviewed_at=CASE WHEN $2='received' THEN NULL WHEN $2='under_review' THEN now() ELSE step_2_reviewed_at END,
      step_3_funded_at=CASE WHEN $2='funded' THEN now() ELSE NULL END,
      step_changed_by=$3,funding_invoice_id=COALESCE(funding_invoice_id,$4)
       WHERE id=$1 AND funding_status=$5 RETURNING id`, [submissionId, data.fundingStatus, actorId, invoice?.id ?? null, data.expectedStatus]);
    if (updated.rowCount !== 1) throw new ClientApiError(409, "Funding progress changed. Refresh before updating it.");
    const event = (await tx.query(`INSERT INTO client_funding_events(submission_id,from_status,to_status,reason,actor_id,actor_name)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [submissionId, sub.funding_status, data.fundingStatus, data.reason || null, actorId, actor.name?.trim() || "TPF staff"])).rows[0];
    const number = sub.invoice_number || String(sub.id);
    let body = data.fundingStatus === "under_review" ? `Your submission #${number} is under review`
      : data.fundingStatus === "received" ? `Your submission #${number} has returned to received status` : "";
    if (data.fundingStatus === "funded") {
      const previousFunding = await tx.query("SELECT 1 FROM client_funding_events WHERE submission_id=$1 AND to_status='funded' AND id<>$2 LIMIT 1", [submissionId, event.id]);
      const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(invoice.amount));
      body = previousFunding.rowCount ? `Funding status for invoice #${number} has been reconfirmed. No additional payment was initiated.`
        : `Invoice #${number} has been funded! ${money} sent to your account on file`;
    }
    await queueClientPush(tx, sub.portal_user_id, submissionId, `funding/${event.id}`, body);
  });
  return clientFundingProgress(submissionId, true);
}

export async function clientNotes(submissionId: number, pageValue: unknown) {
  const page = clientPage(pageValue);
  const [items, total] = await Promise.all([
    pool.query(`SELECT id,message,sender_type AS "senderType",author_name AS "authorName",created_at AS "createdAt"
      FROM client_submission_notes WHERE submission_id=$1 ORDER BY id DESC LIMIT 15 OFFSET $2`, [submissionId, page.offset]),
    pool.query("SELECT count(*)::int AS n FROM client_submission_notes WHERE submission_id=$1", [submissionId]),
  ]);
  return { items: items.rows.map(r => ({ ...r, createdAt: iso(r.createdAt) })), total: total.rows[0].n, page: page.page, pageSize: 15 };
}
export async function addClientNote(submissionId: number, sender: { type: "client"; id: number; carrierId: number } | { type: "staff"; id: string }, input: unknown) {
  const { message } = z.object({ message: z.string().trim().min(1).max(2000) }).strict().parse(input);
  return clientTransaction(async tx => {
    const sub = (await tx.query("SELECT * FROM carrier_submissions WHERE id=$1 FOR UPDATE", [submissionId])).rows[0];
    if (!sub || sender.type === "client" && (sub.portal_user_id !== sender.id || sub.carrier_id !== sender.carrierId)) throw new ClientApiError(404, "Submission not found.");
    const actor = sender.type === "client"
      ? (await tx.query("SELECT COALESCE(client_contact_name,company_name) AS name FROM carrier_portal_users WHERE id=$1 AND status='active'", [sender.id])).rows[0]
      : (await tx.query("SELECT concat_ws(' ',first_name,last_name) AS name FROM users WHERE id=$1 AND status='active'", [sender.id])).rows[0];
    if (!actor) throw new ClientApiError(403, "Account access is disabled.");
    const row = (await tx.query(`INSERT INTO client_submission_notes(submission_id,sender_type,portal_user_id,staff_user_id,author_name,message)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,message,sender_type AS "senderType",author_name AS "authorName",created_at AS "createdAt"`,
    [submissionId, sender.type, sender.type === "client" ? sender.id : null, sender.type === "staff" ? sender.id : null, actor.name?.trim() || "TPF staff", message])).rows[0];
    if (sender.type === "staff") await queueClientPush(tx, sub.portal_user_id, submissionId, `note/${row.id}`, `New message on submission #${sub.invoice_number || sub.id}`);
    return { ...row, createdAt: iso(row.createdAt) };
  });
}

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { sendResendEmail } from "../resendTransport.js";
import { buildChargebackReport } from "./chargebackReport";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Store = typeof db | Tx;
export class ResolutionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const amount = z.coerce.number().finite().positive().max(9999999999.99)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, "Use at most two decimal places.");
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Enter a valid calendar date.").transform(value => new Date(`${value}T12:00:00Z`));
const date = z.union([calendarDay, z.string().datetime({ offset: true }).pipe(z.coerce.date()), z.date()])
  .refine(value => value.toISOString().slice(0,10) <= new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()), "Date cannot be in the future.");
export const refundInput = z.object({
  amount, refundDate: date, reference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000), approvedBy: z.string().trim().min(1),
  idempotencyKey: z.string().uuid(), method: z.string().trim().min(1).max(80).default("recorded"),
}).strict();
export const recoveryInput = z.object({
  amount, date, reference: z.string().trim().min(1).max(200),
  status: z.enum(["resolved", "written_off"]).default("resolved"), idempotencyKey: z.string().uuid(),
}).strict();
function money(value: unknown) { return Math.round(Number(value || 0) * 100); }
function decimal(cents: number) { return (cents / 100).toFixed(2); }

/** No generic reserve adjustment is proof of a chargeback debit. Legacy rows
 * without an explicit, verified accounting event must fail closed. */
export async function chargebackSnapshot(invoiceId: number, store: Store = db) {
  const result = await store.execute(sql`
    SELECT i.id, i.client_id, i.invoice_number, i.chargeback_status, i.chargeback_resolution_status,
      c.name AS carrier_name, c.email AS carrier_email,
      coalesce((SELECT sum(r.amount) FROM invoice_refunds r WHERE r.invoice_id=i.id),0)::text AS refunded,
      coalesce((SELECT sum(r.reserve_credit_amount) FROM invoice_refunds r WHERE r.invoice_id=i.id),0)::text AS restored,
      coalesce((SELECT sum((l.payload_json->>'amount')::numeric)
        FROM event_ledger l JOIN users u ON u.id=l.actor_id
        WHERE l.entity_type='invoice' AND l.entity_id=i.id AND l.event_type='chargeback_reserve_debited'
          AND l.actor_type='user' AND u.role IN ('manager','admin')
          AND l.payload_json->>'verified'='true'
          AND l.payload_json->>'amount' ~ '^[0-9]+([.][0-9]{1,2})?$'),0)::text AS verified_debit
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=${invoiceId}`);
  const row = result.rows[0];
  if (!row) throw new ResolutionError("Invoice not found.", 404);
  // Share the report's historical chargeback reconstruction rather than using
  // a second (potentially different) date basis for the refund limit.
  const chargeback = (await buildChargebackReport({ invoiceId, section: "chargebacks" }, store)).chargebacks[0];
  const original = chargeback?.amount == null ? null : money(chargeback.amount);
  const resolutionStatus = chargeback?.status || String(row.chargeback_resolution_status || "open");
  const refunded = money(row.refunded), verifiedDebit = money(row.verified_debit);
  const remainingDebit = Math.max(0, verifiedDebit - money(row.restored));
  const refundable = row.chargeback_status === "charged" && original != null
    ? Math.max(0, Math.min(original - refunded, remainingDebit)) : 0;
  const blockedReason = row.chargeback_status !== "charged" ? "This invoice has not been charged back."
    : resolutionStatus === "written_off" ? "This chargeback is written off."
    : original == null ? "The original chargeback amount must be verified."
    : verifiedDebit === 0 ? "A verified chargeback reserve debit is required before recording a refund. No reserve deduction is inferred from legacy chargebacks."
    : refundable === 0 ? "No refundable reserve debit remains." : null;
  return { invoiceId, carrierId: Number(row.client_id), carrierName: String(row.carrier_name),
    carrierEmail: row.carrier_email == null ? null : String(row.carrier_email), invoiceNumber: String(row.invoice_number),
    originalAmount: original == null ? null : original / 100, verifiedDebit: verifiedDebit / 100,
    refundedAmount: refunded / 100, refundableAmount: blockedReason ? 0 : refundable / 100,
    resolutionStatus, blockedReason };
}

async function audit(store: Store, invoiceId: number, actor: string, event: string, payload: Record<string, unknown>, description: string) {
  await store.execute(sql`INSERT INTO event_ledger(entity_type,entity_id,event_type,actor_type,actor_id,payload_json)
    VALUES ('invoice',${invoiceId},${event},'user',${actor},${JSON.stringify(payload)}::jsonb)`);
  await store.execute(sql`INSERT INTO activities(user_id,type,description,entity_type,entity_id)
    VALUES (${actor},${event},${description},'invoice',${invoiceId})`);
}

export async function recordChargebackRefund(invoiceId: number, input: unknown, actor: string, store: Store = db,
  send: typeof sendResendEmail = sendResendEmail) {
  const data = refundInput.parse(input), cents = money(data.amount);
  const committed = await store.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM invoices WHERE id=${invoiceId} FOR UPDATE`);
    const previous = await tx.execute(sql`SELECT * FROM invoice_refunds WHERE idempotency_key=${data.idempotencyKey}::uuid`);
    if (previous.rows.length) {
      const row = previous.rows[0];
      if (Number(row.invoice_id) !== invoiceId || row.created_by !== actor || money(row.amount) !== cents
        || row.reference !== data.reference || row.notes !== data.reason || row.approved_by !== data.approvedBy
        || new Date(String(row.refund_date)).getTime() !== data.refundDate.getTime() || row.method !== data.method)
        throw new ResolutionError("This refund request key has already been used for different details.");
      return { refund: row, duplicate: true, snapshot: await chargebackSnapshot(invoiceId, tx) };
    }
    const snapshot = await chargebackSnapshot(invoiceId, tx);
    if (snapshot.blockedReason) throw new ResolutionError(snapshot.blockedReason);
    if (cents > money(snapshot.refundableAmount)) throw new ResolutionError("Refund exceeds the remaining verified reserve debit or original chargeback.");
    const approver = await tx.execute(sql`SELECT id FROM users WHERE id=${data.approvedBy}
      AND status='active' AND role IN ('admin','manager') AND is_test_account=false FOR SHARE`);
    if (!approver.rows.length) throw new ResolutionError("Choose an active manager or admin as the refund approver.", 400);
    const rows = await tx.execute(sql`INSERT INTO invoice_refunds
      (invoice_id,amount,refund_date,method,reference,notes,created_by,approved_by,idempotency_key,reserve_credit_amount)
      VALUES (${invoiceId},${decimal(cents)},${data.refundDate},${data.method},${data.reference},${data.reason},
        ${actor},${data.approvedBy},${data.idempotencyKey}::uuid,${decimal(cents)}) RETURNING *`);
    await tx.execute(sql`UPDATE clients SET reserves=coalesce(reserves,0)+${decimal(cents)}::numeric WHERE id=${snapshot.carrierId}`);
    const status = money(snapshot.refundedAmount) + cents >= money(snapshot.originalAmount) ? "refunded" : "open";
    await tx.execute(sql`UPDATE invoices SET chargeback_resolution_status=${status},updated_at=now() WHERE id=${invoiceId}`);
    const description = `Chargeback refunded — $${decimal(cents)} returned to ${snapshot.carrierName} on ${data.refundDate.toISOString().slice(0,10)}, payment ref ${data.reference}`;
    await tx.execute(sql`INSERT INTO invoice_chargeback_events(invoice_id,event_type,reason,actor_id,metadata)
      VALUES (${invoiceId},'refunded',${data.reason},${actor},${JSON.stringify({
        refundId: rows.rows[0].id, amount: decimal(cents), reference: data.reference, approvedBy: data.approvedBy,
        refundDate: data.refundDate.toISOString(), reserveCreditAmount: decimal(cents),
      })}::jsonb)`);
    await audit(tx, invoiceId, actor, "chargeback_refunded", {
      refundId: rows.rows[0].id, amount: decimal(cents), reference: data.reference, reason: data.reason,
      carrierName: snapshot.carrierName, refundDate: data.refundDate.toISOString(), approvedBy: data.approvedBy,
      reserveCreditAmount: decimal(cents), method: data.method, description,
    }, description);
    return { refund: rows.rows[0], duplicate: false, snapshot };
  });
  // Never roll back a financial entry because an email failed, nor resend on an
  // HTTP retry. Resend's idempotency key protects transport retries as well.
  if (committed.duplicate) return { refund: committed.refund, emailStatus: committed.refund.email_status,
    emailError: committed.refund.email_error, duplicate: true };
  let emailStatus = "sent", emailError: string | null = null;
  try {
    if (!z.string().email().safeParse(committed.snapshot.carrierEmail).success) throw new Error("Carrier has no valid email address.");
    await send({
      to: committed.snapshot.carrierEmail!, subject: `Chargeback refund — Invoice ${committed.snapshot.invoiceNumber}`,
      text: `Your chargeback of $${Number(committed.snapshot.originalAmount).toFixed(2)} on Invoice ${committed.snapshot.invoiceNumber} has been refunded. Amount: $${decimal(cents)}. Payment reference: ${data.reference}.`,
      idempotencyKey: `chargeback-refund/${committed.refund.id}`,
      emailLog: { templateName: "chargeback_refund", entityType: "invoice", entityId: invoiceId, sentByUserId: actor },
    });
  } catch (error) { emailStatus = "failed"; emailError = error instanceof Error ? error.message : "Refund notification failed."; }
  await store.execute(sql`UPDATE invoice_refunds SET email_status=${emailStatus},email_error=${emailError} WHERE id=${committed.refund.id}`);
  return { refund: committed.refund, emailStatus, emailError };
}

export async function recordShortPayResolution(invoiceId: number, input: unknown, actor: string, store: Store = db) {
  const data = recoveryInput.parse(input), cents = money(data.amount);
  return store.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT * FROM invoices WHERE id=${invoiceId} FOR UPDATE`);
    const invoice = locked.rows[0];
    if (!invoice) throw new ResolutionError("Invoice not found.", 404);
    const previous = await tx.execute(sql`SELECT * FROM short_pay_resolutions WHERE idempotency_key=${data.idempotencyKey}::uuid`);
    const kind = data.status === "resolved" ? "recovered" : "written_off";
    if (previous.rows.length) {
      const row = previous.rows[0];
      if (Number(row.invoice_id) !== invoiceId || row.created_by !== actor || money(row.amount) !== cents
        || row.reference !== data.reference || row.kind !== kind || new Date(String(row.resolution_date)).getTime() !== data.date.getTime())
        throw new ResolutionError("This resolution request key has already been used for different details.");
      return row;
    }
    if (!invoice.funded_at || ["paid","settled","rejected","void","cancelled"].includes(String(invoice.status)))
      throw new ResolutionError("Only an open funded invoice can receive a short-pay resolution.");
    const balances = await tx.execute(sql`SELECT coalesce(sum(applied_amount),0)::text AS paid,
      coalesce(sum(CASE WHEN variance_type='write_off' THEN abs(coalesce(variance,0)) ELSE 0 END),0)::text AS written_off
      FROM payment_application_lines WHERE invoice_id=${invoiceId}`);
    const outstanding = Math.max(0, money(invoice.amount) - money(balances.rows[0].paid) - money(balances.rows[0].written_off));
    if (!outstanding || cents > outstanding) throw new ResolutionError("Resolution exceeds the invoice's current outstanding balance.");
    const earliest = await tx.execute(sql`SELECT original_short_pay FROM short_pay_resolutions WHERE invoice_id=${invoiceId} ORDER BY id LIMIT 1`);
    const originalShortPay = earliest.rows[0]?.original_short_pay ?? decimal(outstanding);
    const cash = await tx.execute(sql`INSERT INTO cash_applications
      (payment_reference,payor_name,payment_date,total_received,payment_method,status,processed_by,notes)
      VALUES (${`short-pay/${data.idempotencyKey}`},'Short-pay resolution',${data.date},
        ${kind === "recovered" ? decimal(cents) : "0.00"},'other','fully_applied',${actor},${data.reference}) RETURNING id`);
    await tx.execute(sql`INSERT INTO payment_application_lines
      (cash_application_id,invoice_id,invoice_number,invoice_amount,applied_amount,variance,variance_type,variance_reason)
      VALUES (${cash.rows[0].id},${invoiceId},${invoice.invoice_number},${invoice.amount},
        ${kind === "recovered" ? decimal(cents) : "0.00"},${kind === "written_off" ? decimal(cents) : "0.00"},
        ${kind === "written_off" ? "write_off" : "short_pay"},${data.reference})`);
    const resolution = await tx.execute(sql`INSERT INTO short_pay_resolutions
      (invoice_id,original_short_pay,amount,resolution_date,reference,kind,cash_application_id,created_by,idempotency_key)
      VALUES (${invoiceId},${originalShortPay},${decimal(cents)},${data.date},${data.reference},${kind},
        ${cash.rows[0].id},${actor},${data.idempotencyKey}::uuid) RETURNING *`);
    if (cents === outstanding) {
      await tx.execute(sql`UPDATE exceptions SET status=${kind === "written_off" ? "waived" : "resolved"},resolved_by=${actor},
        resolved_at=now(),resolution=${data.reference},updated_at=now() WHERE type='short_pay' AND entity_type='invoice' AND entity_id=${invoiceId} AND status IN ('open','under_review')`);
    }
    await audit(tx, invoiceId, actor, "short_pay_resolved", {
      resolutionId: resolution.rows[0].id, amount: decimal(cents), reference: data.reference, kind,
      date: data.date.toISOString(), outstanding: decimal(outstanding-cents),
    }, `Short pay ${kind}: $${decimal(cents)}, reference ${data.reference}`);
    return resolution.rows[0];
  });
}

export async function chargebackLifecycle(invoiceId: number, store: Store = db) {
  const snapshot = await chargebackSnapshot(invoiceId, store);
  const [events, refunds] = await Promise.all([
    store.execute(sql`SELECT e.id,e.event_type AS "eventType",e.created_at AS "createdAt",
      coalesce(nullif(trim(concat(u.first_name,' ',u.last_name)),''),'System') AS "actorName",
      coalesce(e.payload_json->>'amount',e.payload_json->>'chargebackAmount') AS amount,
      e.payload_json->>'reason' AS reason,e.payload_json->>'reference' AS reference
      FROM event_ledger e LEFT JOIN users u ON u.id=e.actor_id
      WHERE e.entity_type='invoice' AND e.entity_id=${invoiceId}
        AND (e.event_type LIKE 'chargeback_%' OR e.event_type LIKE 'broker_collection%' OR e.event_type LIKE 'broker_follow%'
          OR e.event_type IN ('payment_applied','payment_received','short_pay_resolved'))
      UNION ALL SELECT -h.id,h.event_type,h.created_at,coalesce(nullif(trim(concat(u.first_name,' ',u.last_name)),''),'System'),
        h.metadata->>'amount',h.reason,h.metadata->>'reference'
        FROM invoice_chargeback_events h LEFT JOIN users u ON u.id=h.actor_id
        WHERE h.invoice_id=${invoiceId} AND NOT EXISTS (SELECT 1 FROM event_ledger e
          WHERE e.entity_type='invoice' AND e.entity_id=h.invoice_id
            AND (e.payload_json->>'refundId')=(h.metadata->>'refundId') AND h.metadata->>'refundId' IS NOT NULL)
      UNION ALL SELECT p.id+1000000000,'payment_received',coalesce(a.payment_date,p.created_at),
        coalesce(nullif(trim(concat(u.first_name,' ',u.last_name)),''),'Not recorded'),
        p.applied_amount::text,p.variance_reason,a.payment_reference
      FROM payment_application_lines p JOIN cash_applications a ON a.id=p.cash_application_id
        LEFT JOIN users u ON u.id=a.processed_by
      WHERE p.invoice_id=${invoiceId} AND p.applied_amount>0
        AND NOT EXISTS (SELECT 1 FROM short_pay_resolutions x WHERE x.cash_application_id=a.id)
      ORDER BY "createdAt",id`),
    store.execute(sql`SELECT r.id,r.amount,r.refund_date AS "refundDate",r.reference,r.notes,r.approved_by AS "approvedBy",r.created_by AS "createdBy",
      r.email_status AS "emailStatus",r.email_error AS "emailError",
      trim(concat(a.first_name,' ',a.last_name)) AS "approverName",trim(concat(u.first_name,' ',u.last_name)) AS "actorName"
      FROM invoice_refunds r LEFT JOIN users a ON a.id=r.approved_by LEFT JOIN users u ON u.id=r.created_by
      WHERE r.invoice_id=${invoiceId} ORDER BY r.refund_date,r.id`),
  ]);
  // Carrier contact information is only used server-side by the mail wrapper.
  const { carrierEmail: _email, ...publicSnapshot } = snapshot;
  return { ...publicSnapshot, events: events.rows, refunds: refunds.rows };
}

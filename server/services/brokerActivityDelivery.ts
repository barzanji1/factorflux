import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { sendEmail } from "../emailService";
import { escapeEmailHtml, wrapEmail } from "../emailTemplate.js";
import { BROKER_PUBLIC_ORIGIN } from "./brokerConfirmationPresentation";

type MailSend = typeof sendEmail;
export async function deliverBrokerActivityEmails(send: MailSend = sendEmail, allowTest = false, onlyUserId: string | null = null) {
  const lease = randomUUID();
  await pool.query(`UPDATE broker_activity_deliveries SET email_state='failed',lease_token=NULL,last_error_code='LEASE_EXHAUSTED'
    WHERE email_state='sending' AND attempts>=5 AND claimed_at<now()-interval '2 minutes'`);
  // One bounded email per tick; expired leases recover after a process crash.
  const claim = await pool.query(`WITH candidate AS (
    SELECT d.id FROM broker_activity_deliveries d WHERE
      ((d.email_state='queued' AND d.next_attempt_at<=now()) OR (d.email_state='sending' AND d.claimed_at<now()-interval '2 minutes'))
      AND d.attempts<5 AND ($2::varchar IS NULL OR d.user_id=$2) ORDER BY d.next_attempt_at,d.id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE broker_activity_deliveries d SET email_state='sending',claimed_at=now(),lease_token=$1,attempts=d.attempts+1
    FROM candidate WHERE d.id=candidate.id RETURNING d.*`, [lease, onlyUserId]);
  const job = claim.rows[0];
  if (!job) return false;
  const context = await pool.query(`SELECT a.*,u.email AS recipient,u.role,u.status AS user_status,u.is_test_account,
    COALESCE(p.email,false) AS enabled FROM broker_activity_actions a
    JOIN users u ON u.id=$2 LEFT JOIN broker_notification_preferences p ON p.user_id=u.id WHERE a.event_id=$1`, [job.event_id, job.user_id]);
  const row = context.rows[0];
  const finish = (state: string, code: string | null) => pool.query(`UPDATE broker_activity_deliveries SET email_state=$1,last_error_code=$2,
    lease_token=NULL,claimed_at=NULL,next_attempt_at=now()+interval '1 minute'*LEAST(60,power(2,attempts))
    WHERE id=$3 AND lease_token=$4`, [state, code, job.id, lease]);
  if (!row || !row.enabled || !["admin", "manager"].includes(row.role) || row.user_status !== "active" || !row.recipient || (!allowTest && row.is_test_account)) {
    await finish("skipped", null); return true;
  }
  try {
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(row.invoice_amount));
    const message = `${row.broker_name} ${row.status} Invoice #${row.invoice_number} for ${amount}`;
    const url = `${BROKER_PUBLIC_ORIGIN}/invoices/${row.invoice_id}`;
    const accepted = await send({
      to: row.recipient, subject: message, text: `${message}\n\nOpen the invoice: ${url}`,
      html: wrapEmail(`Broker invoice ${row.status}`, `<p>${escapeEmailHtml(message)}</p><p><a href="${escapeEmailHtml(url)}">View invoice in FactorFlux</a></p>`),
      idempotencyKey: `broker-activity/${row.event_id}/${job.user_id}`,
      emailLog: { templateName: "broker_activity_notification", entityType: "invoice", entityId: row.invoice_id },
    });
    if (!accepted) throw new Error("DELIVERY_NOT_CONFIRMED");
    await finish("sent", null);
  } catch {
    await finish(job.attempts >= 5 ? "failed" : "queued", "DELIVERY_NOT_CONFIRMED");
  }
  return true;
}

let started = false;
export function startBrokerActivityWorker() {
  if (started) return;
  started = true;
  let busy = false, lastError = 0, triggerVerified = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (!triggerVerified) {
        const installed = await pool.query(`SELECT EXISTS(
          SELECT 1 FROM pg_catalog.pg_trigger
          WHERE tgrelid=to_regclass('public.broker_confirmation_events')
          AND tgname='broker_activity_atomic_capture' AND NOT tgisinternal AND tgenabled IN ('O','A')
          AND tgfoid='public.capture_broker_activity_response()'::regprocedure
        ) AS installed`);
        if (!installed.rows[0]?.installed) throw new Error("ATOMIC_CAPTURE_MIGRATION_REQUIRED");
        triggerVerified = true;
      }
      // Snapshots, bell alerts and queued jobs are written by the approved DB
      // trigger. Never fall back to a late observer that can capture an edit.
      // Never send live broker-action alert emails from Preview or test fixtures.
      if (process.env.NODE_ENV === "production") await deliverBrokerActivityEmails();
    } catch {
      if (Date.now() - lastError > 60000) { console.error("[brokerActivity] Activity delivery unavailable; verify its migration."); lastError = Date.now(); }
    } finally { busy = false; }
  }, 1000);
  timer.unref();
}

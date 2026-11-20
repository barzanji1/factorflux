import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { sendEmail } from "../emailService";
import { escapeEmailHtml, wrapEmail } from "../emailTemplate.js";
import { BROKER_PUBLIC_ORIGIN } from "./brokerConfirmationPresentation";

// Transactional, idempotent event ingestion. This also repairs uncaptured
// events without relying on a serial-ID watermark (late commits can have older
// IDs). A DB trigger, when enabled, makes this repair path a no-op.
export async function captureBrokerActivityBatch(onlyInvoiceIds: readonly number[] | null = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const events = await client.query(`SELECT e.id FROM broker_confirmation_events e
      WHERE e.event IN ('confirmed','disputed') AND ($1::int[] IS NULL OR e.invoice_id=ANY($1::int[]))
      AND NOT EXISTS(SELECT 1 FROM broker_activity_actions a WHERE a.event_id=e.id)
      ORDER BY e.id LIMIT 50 FOR UPDATE OF e SKIP LOCKED`, [onlyInvoiceIds]);
    for (const { id } of events.rows) {
      const result = await client.query(`INSERT INTO broker_activity_actions(event_id,invoice_id,broker_id,broker_name,client_name,
        invoice_number,invoice_amount,approved_amount,status,method,actor,sent_at,acted_at,is_test)
        SELECT e.id,i.id,i.broker_id,COALESCE(b.name,'Unknown broker'),COALESCE(c.name,'Unknown client'),i.invoice_number,
        i.amount,CASE WHEN e.event='confirmed' THEN i.amount END,e.event::text,
        CASE WHEN e.actor ~ '\\[portal:[0-9]+; broker:[0-9]+\\]$' THEN 'portal'
             WHEN e.actor LIKE 'agent:%' OR e.actor IN ('system','scheduler') THEN NULL ELSE 'email' END,e.actor,
        i.confirmation_sent_at AT TIME ZONE 'UTC',e.created_at AT TIME ZONE 'UTC',COALESCE(owner.is_test_account,false)
        FROM broker_confirmation_events e JOIN invoices i ON i.id=e.invoice_id LEFT JOIN brokers b ON b.id=i.broker_id
        LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN users owner ON owner.id=i.submitted_by
        WHERE e.id=$1 ON CONFLICT(event_id) DO NOTHING RETURNING *`, [id]);
      const action = result.rows[0];
      if (!action?.method) continue; // Do not misattribute staff-entered confirmations to a broker.
      const recipients = await client.query(`INSERT INTO broker_activity_deliveries(event_id,user_id,email_state)
        SELECT $1,u.id,CASE WHEN COALESCE(p.email,false) THEN 'queued' ELSE 'skipped' END
        FROM users u LEFT JOIN broker_notification_preferences p ON p.user_id=u.id
        WHERE u.role IN ('admin','manager') AND u.status='active' AND COALESCE(u.is_test_account,false)=$2
        ON CONFLICT(event_id,user_id) DO NOTHING RETURNING id,user_id`, [id, action.is_test]);
      for (const recipient of recipients.rows) {
        const pref = await client.query("SELECT in_app FROM broker_notification_preferences WHERE user_id=$1", [recipient.user_id]);
        if (pref.rows[0]?.in_app === false) continue;
        const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(action.invoice_amount));
        const message = `${action.broker_name} ${action.status} Invoice #${action.invoice_number} for ${amount}`;
        const inserted = await client.query(`INSERT INTO notifications(user_id,title,message,type,entity_type,entity_id,action_url,metadata)
          VALUES($1,$2,$3,$4,'broker_response',$5,$6,$7) RETURNING id`,
        [recipient.user_id, `Broker invoice ${action.status}`, message, action.status === "confirmed" ? "success" : "warning",
          action.invoice_id, `/invoices/${action.invoice_id}`, JSON.stringify({ brokerActivityEventId: id, method: action.method })]);
        await client.query("UPDATE broker_activity_deliveries SET notification_id=$1 WHERE id=$2", [inserted.rows[0].id, recipient.id]);
      }
    }
    await client.query("COMMIT");
    return events.rowCount || 0;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

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
  let busy = false, lastError = 0;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await captureBrokerActivityBatch();
      // Never send live broker-action alert emails from Preview or test fixtures.
      if (process.env.NODE_ENV === "production") await deliverBrokerActivityEmails();
    } catch {
      if (Date.now() - lastError > 60000) { console.error("[brokerActivity] Activity delivery unavailable; verify its migration."); lastError = Date.now(); }
    } finally { busy = false; }
  }, 1000);
  timer.unref();
}

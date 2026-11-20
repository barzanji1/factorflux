import { createHash, randomUUID } from "node:crypto";
import { getApps } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";
import "../firebase";
import { z } from "zod";
import { pool } from "../db";
import { ClientApiError, clientTransaction } from "./clientApiCommon";
import { cleanupExpiredClientUpload } from "./clientSubmissions";

export async function registerClientPushToken(userId: number, input: unknown) {
  if (process.env.NODE_ENV === "production" && !getApps().length) throw new ClientApiError(503, "Push delivery is not configured.");
  const data = z.object({ token: z.string().trim().min(20).max(4096), platform: z.enum(["ios", "android", "web"]) }).strict().parse(input);
  return clientTransaction(async tx => {
    await tx.query("SELECT id FROM carrier_portal_users WHERE id=$1 FOR UPDATE", [userId]);
    const existing = (await tx.query("SELECT id,portal_user_id,active FROM client_push_tokens WHERE token=$1 FOR UPDATE", [data.token])).rows[0];
    if (existing?.active && existing.portal_user_id !== userId) throw new ClientApiError(409, "This device token belongs to another account. Sign out and unregister it first.");
    const count = (await tx.query("SELECT count(*)::int AS n FROM client_push_tokens WHERE portal_user_id=$1 AND active", [userId])).rows[0].n;
    if (count >= 10 && !(existing?.portal_user_id === userId && existing.active)) throw new ClientApiError(409, "Maximum ten registered devices per account.");
    const row = (await tx.query(`INSERT INTO client_push_tokens(portal_user_id,token,platform) VALUES($1,$2,$3)
      ON CONFLICT(token) DO UPDATE SET portal_user_id=EXCLUDED.portal_user_id,platform=EXCLUDED.platform,active=true,updated_at=now()
      WHERE NOT client_push_tokens.active OR client_push_tokens.portal_user_id=EXCLUDED.portal_user_id RETURNING id`,
    [userId, data.token, data.platform])).rows[0];
    if (!row) throw new ClientApiError(409, "Device token ownership changed. Retry registration.");
    return { id: row.id, registered: true, deliveryEnabled: process.env.NODE_ENV === "production" && getApps().length > 0 };
  });
}
export async function unregisterClientPushToken(userId: number, input: unknown) {
  const { token } = z.object({ token: z.string().min(20).max(4096) }).strict().parse(input);
  await pool.query("UPDATE client_push_tokens SET active=false,updated_at=now() WHERE portal_user_id=$1 AND token=$2", [userId, token]);
  return { registered: false };
}
type PushSend = (message: Message) => Promise<string>;
const firebaseSend: PushSend = async message => {
  if (!getApps().length) throw Object.assign(new Error("FCM_NOT_CONFIGURED"), { code: "app/no-app" });
  return getMessaging().send(message);
};
export async function deliverClientPush(send: PushSend = firebaseSend, onlyUserId: number | null = null) {
  const lease = randomUUID();
  await pool.query(`UPDATE client_push_deliveries SET state='failed',lease_token=NULL,last_error_code='LEASE_EXHAUSTED'
    WHERE state='sending' AND attempts>=5 AND claimed_at<now()-interval '2 minutes'
    AND ($1::int IS NULL OR portal_user_id=$1)`, [onlyUserId]);
  const job = (await pool.query(`WITH candidate AS (
    SELECT id FROM client_push_deliveries WHERE attempts<5 AND ($2::int IS NULL OR portal_user_id=$2) AND
      ((state='queued' AND next_attempt_at<=now()) OR (state='sending' AND claimed_at<now()-interval '2 minutes'))
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE client_push_deliveries d SET state='sending',lease_token=$1,claimed_at=now(),attempts=d.attempts+1
    FROM candidate WHERE d.id=candidate.id RETURNING d.*`, [lease, onlyUserId])).rows[0];
  if (!job) return false;
  const context = (await pool.query(`SELECT t.token FROM client_push_tokens t
    JOIN carrier_portal_users u ON u.id=t.portal_user_id
    JOIN carrier_submissions s ON s.portal_user_id=u.id AND s.id=$3
    WHERE t.id=$1 AND t.portal_user_id=$2 AND t.active AND u.status='active' AND u.client_email_verified_at IS NOT NULL
      AND s.carrier_id=u.carrier_id AND (
        EXISTS(SELECT 1 FROM users WHERE id=u.reviewed_by AND role='admin') OR (
          (SELECT count(*) FROM clients WHERE lower(btrim(email))=lower(btrim(u.email)))=1
          AND EXISTS(SELECT 1 FROM clients WHERE id=u.carrier_id AND lower(btrim(email))=lower(btrim(u.email)))) )`,
  [job.token_id, job.portal_user_id, job.submission_id])).rows[0];
  const finish = (state: string, code: string | null) => pool.query(`UPDATE client_push_deliveries
    SET state=$1,last_error_code=$2,lease_token=NULL,claimed_at=NULL,next_attempt_at=now()+interval '1 minute'*LEAST(60,power(2,attempts))
    WHERE id=$3 AND lease_token=$4`, [state, code, job.id, lease]);
  if (!context) { await finish("skipped", null); return true; }
  try {
    const collapse = createHash("sha256").update(job.dedupe_key).digest("hex");
    await send({ token: context.token, notification: { title: job.title, body: job.body },
      data: { submissionId: String(job.submission_id), eventId: String(job.id), type: "submission_update" },
      android: { collapseKey: collapse, ttl: 3600000 },
      apns: { headers: { "apns-collapse-id": collapse }, payload: { aps: { sound: "default" } } },
    });
    await finish("sent", null);
  } catch (error: any) {
    const invalid = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error?.code);
    if (invalid) await pool.query("UPDATE client_push_tokens SET active=false,updated_at=now() WHERE id=$1 AND portal_user_id=$2", [job.token_id, job.portal_user_id]);
    await finish(invalid ? "skipped" : job.attempts >= 5 ? "failed" : "queued", invalid ? "INVALID_DEVICE_TOKEN" : "PUSH_DELIVERY_FAILED");
  }
  return true;
}
let started = false;
export function startClientPushWorker() {
  if (started) return; started = true;
  let busy = false, lastError = 0, cleanupAt = 0, uploadsCleanupAt = 0, nextPollAt = 0;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      // Preview must never send notifications to real registered devices.
      if (process.env.NODE_ENV === "production" && Date.now() >= nextPollAt) {
        const delivered = await deliverClientPush();
        nextPollAt = Date.now() + (delivered ? 0 : 5000);
      }
      if (Date.now() > cleanupAt) {
        await pool.query(`DELETE FROM client_registration_attempts WHERE id IN
          (SELECT id FROM client_registration_attempts WHERE attempted_at<now()-interval '2 days' LIMIT 1000)`);
        cleanupAt = Date.now() + 3600000;
      }
      if (Date.now() >= uploadsCleanupAt) { await cleanupExpiredClientUpload(); uploadsCleanupAt = Date.now() + 60000; }
    } catch {
      if (Date.now() - lastError > 60000) { console.error("[clientApi] Push delivery unavailable; verify configuration and migration."); lastError = Date.now(); }
    } finally { busy = false; }
  }, 1000);
  timer.unref();
}

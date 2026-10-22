/**
 * Explicit live verification, authorized for Dosh's mailbox only.
 * Run: npx tsx scripts/verify-scheduled-broadcast.ts --send-test
 * Uses the real API, normal background worker and Resend wrapper; never calls tick.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import type { BroadcastDetail, BroadcastSummary } from "../shared/email-broadcast";
const target = "dosh@truckingprosfinancial.com";
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let cookie = "";
const active = new Set<string>();
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (path === "/api/auth/login") cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/json"), `${path} must return JSON`);
  return response.json() as Promise<T>;
}
async function main() {
  assert(process.argv.includes("--send-test"), "Use --send-test to explicitly authorize this live verification.");
  assert(process.env.REPLIT_DEV_DOMAIN && process.env.DEV_ADMIN_EMAIL && process.env.DEV_ADMIN_PASSWORD, "Configured development login is required.");
  const { rows } = await pool.query<{ id: number }>(
    "select id from clients where lower(trim(email))=$1 and upper(name) like 'TEST%' order by id limit 1", [target],
  );
  assert.equal(rows.length, 1, "A test client with the authorized mailbox must already exist; no real carrier records are modified.");
  const clientId = rows[0].id;
  const login = await api("/api/auth/login", { username: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD });
  assert.equal(login.user?.role, "admin");
  assert(cookie, "Session cookie missing");
  const input = {
    requestId: randomUUID(), subject: "TPF scheduled closure-notice TEST — no office closure",
    body: "Hello [Company],\n\nThis is a one-recipient scheduling verification for Dosh. This is a test only; it does not announce an office closure. No other client will receive this broadcast.",
    templateName: "office-closed", filters: {}, clientIds: [clientId],
    scheduledAt: new Date(Date.now() + 90000).toISOString(), scheduleTimeZone: "America/Denver",
  };
  const cancelled = await api<BroadcastDetail>("/api/email-broadcasts/preview", { ...input, requestId: randomUUID() });
  active.add(cancelled.broadcast.id);
  assert.equal(cancelled.broadcast.counts.sendable, 1);
  assert.equal(cancelled.recipients[0].email, target);
  await api(`/api/email-broadcasts/${cancelled.broadcast.id}/confirm`, { recipientCount: 1, expectedRevision: 1 });
  assert((await api<BroadcastSummary[]>("/api/email-broadcasts/scheduled")).some(row => row.id === cancelled.broadcast.id));
  const cancelResult = await api<BroadcastDetail>(`/api/email-broadcasts/${cancelled.broadcast.id}/cancel`, {});
  assert.equal(cancelResult.broadcast.status, "cancelled");
  active.delete(cancelled.broadcast.id);
  const preview = await api<BroadcastDetail>("/api/email-broadcasts/preview", input);
  const id = preview.broadcast.id;
  active.add(id);
  assert.equal(preview.broadcast.counts.sendable, 1);
  assert.deepEqual(preview.broadcast.clientIds, [clientId]);
  assert.equal(preview.recipients.length, 1);
  assert.equal(preview.recipients[0].email, target);
  await api(`/api/email-broadcasts/${id}/confirm`, { recipientCount: 1, expectedRevision: 1 });
  const scheduledAt = new Date(Date.now() + 75000).toISOString();
  const edited = await api<BroadcastDetail>(`/api/email-broadcasts/${id}/edit-preview`, {
    ...input, requestId: randomUUID(), expectedRevision: 1, scheduledAt,
    body: `${input.body}\n\nThis message was edited and explicitly reconfirmed before its scheduled send.`,
  });
  assert.equal(edited.broadcast.status, "draft");
  assert.equal(edited.broadcast.revision, 2);
  await api(`/api/email-broadcasts/${id}/confirm`, { recipientCount: 1, expectedRevision: 2 });
  const list = await api<BroadcastSummary[]>("/api/email-broadcasts/scheduled");
  assert(list.some(row => row.id === id && row.status === "scheduled"));
  console.log(JSON.stringify({ scheduledTest: id, cancelledTest: cancelled.broadcast.id, scheduledAt,
    recipient: target, recipientCount: 1, editedAndReconfirmed: true, usesNormalWorker: true }));
  let result: BroadcastDetail | undefined;
  const deadline = new Date(scheduledAt).getTime() + 120000;
  while (Date.now() < deadline) {
    result = await api<BroadcastDetail>(`/api/email-broadcasts/${id}`);
    if (Date.now() < new Date(scheduledAt).getTime()) {
      assert.equal(result.broadcast.counts.sent, 0, "Broadcast sent before scheduled time");
    }
    if (["completed", "failed", "cancelled"].includes(result.broadcast.status)) break;
    await pause(1500);
  }
  assert(result);
  assert.equal(result.broadcast.status, "completed", result.broadcast.error ?? "Worker did not complete");
  assert.equal(result.broadcast.counts.sent, 1, result.recipients[0]?.error ?? "Provider send failed");
  assert.equal(result.broadcast.counts.failed, 0);
  assert.equal(result.recipients[0].email, target);
  assert(result.recipients[0].sentAt && result.recipients[0].providerMessageId);
  assert(new Date(result.recipients[0].sentAt).getTime() >= new Date(scheduledAt).getTime());
  active.delete(id);
  let log: any;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { rows } = await pool.query(
      "select status, to_addresses, cc_addresses, from_address, resend_message_id from email_log where resend_message_id=$1 order by created_at desc limit 1",
      [result.recipients[0].providerMessageId],
    );
    log = rows[0];
    if (log && ["delivered", "bounced", "complained", "failed"].includes(log.status)) break;
    await pause(2000);
  }
  assert(log, "Outbound log row missing");
  assert.deepEqual(log.to_addresses, [target]);
  assert(!log.cc_addresses?.length);
  const cancellation = await api<BroadcastDetail>(`/api/email-broadcasts/${cancelled.broadcast.id}`);
  assert.equal(cancellation.broadcast.counts.sent, 0);
  assert.equal(cancellation.broadcast.status, "cancelled");
  console.log(JSON.stringify({ verified: true, broadcastId: id, scheduledAt, sentAt: result.recipients[0].sentAt,
    latenessMs: new Date(result.recipients[0].sentAt!).getTime() - new Date(scheduledAt).getTime(),
    recipient: target, recipientCount: 1, providerMessageId: result.recipients[0].providerMessageId,
    emailLogStatus: log.status, from: log.from_address, cc: [], cancelledScheduleSent: 0 }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; })
  .finally(async () => {
    for (const id of active) await api(`/api/email-broadcasts/${id}/cancel`, {}).catch(() => {});
    if (cookie) await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } }).catch(() => {});
    await pool.end();
  });

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { emailLog, emailRetryPayloads } from "../../shared/schema";
import { createResendTransport, SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO, type ResendEmailParams } from "../resendTransport.js";
import { claimEmailRetry, createEmailLogRecorder, emailPreview, processResendEvent, type EmailStore } from "./emailLogService";
import { listEmailLog, readEmailLog, summarizeEmailLog } from "./emailLogReader";
import { verifyResendWebhook } from "./resendWebhook";
import { registerEmailLogRoutes } from "../routes/emailLog";
import { currentEmailActor, emailActorContext } from "./emailContext";

after(() => pool.end());
const testKey = Buffer.alloc(32, 42);
const testSecret = `whsec_${testKey.toString("base64")}`;
function signature(raw: Buffer, eventId: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return { id: eventId, timestamp, signature: `v1,${createHmac("sha256", testKey).update(`${eventId}.${timestamp}.`).update(raw).digest("base64")}` };
}
async function fixture(run: (store: EmailStore) => Promise<void>) {
  const rollback = new Error("ROLLBACK_EMAIL_TEST");
  try { await db.transaction(async tx => { await run(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
function message(): ResendEmailParams {
  return { to: "delivered@resend.dev", cc: ["copy@example.test"], subject: `Email fixture ${randomUUID()}`,
    html: "<h1>Hello</h1><p>Please review your invoice.</p>", idempotencyKey: `fixture/${randomUUID()}`,
    emailLog: { templateName: "fixture", entityType: "invoice", entityId: 123, sentByUserId: null } };
}

test("summary uses all filtered emails across pagination, UTC weeks and entity types without exposing messages", async () => fixture(async store => {
  const subject = `Summary fixture ${randomUUID()}`;
  await store.insert(emailLog).values(
    (["sent", "delivered", "bounced", "failed", "complained"] as const).map((status, index) => ({
      direction: "outbound" as const, fromAddress: "fixture@example.test",
      toAddresses: ["private@example.test"], subject, bodyPreview: "Private preview",
      status, entityType: index < 3 ? "invoice" : "broker",
      createdAt: new Date("2026-10-20T18:00:00Z"),
    })),
  );
  const summary = await summarizeEmailLog({ q: subject, from: "2026-10-20", to: "2026-10-20", pageSize: 1 }, store);
  assert.deepEqual(summary.totals, { sent: 4, delivered: 1, bounced: 1, failed: 1 });
  assert.deepEqual(summary.weeks, [{ week: "2026-10-19", delivered: 1, unsuccessful: 2 }]);
  assert.deepEqual(summary.entityTypes.sort((a, b) => String(a.entityType).localeCompare(String(b.entityType))),
    [{ entityType: "broker", count: 2 }, { entityType: "invoice", count: 3 }]);
  const broker = await summarizeEmailLog({ q: subject, entityType: "broker" }, store);
  assert.equal(broker.totals.sent, 1);
  const delivered = await summarizeEmailLog({ q: subject, status: "delivered" }, store);
  assert.equal(delivered.totals.delivered, 1);
  const none = await summarizeEmailLog({ q: subject, from: "2026-10-21" }, store);
  assert.deepEqual(none.totals, { sent: 0, delivered: 0, bounced: 0, failed: 0 });
  assert.deepEqual(none.weeks, []);
  assert.ok(!JSON.stringify(summary).includes("private@example.test"));
  assert.ok(!JSON.stringify(summary).includes("Private preview"));
}));

test("preview is plain text, capped at 200 and redacts credentials and bearer confirmation links", () => {
  const preview = emailPreview({ html: `<style>secret css</style><script>script secret</script><h1>Hello &amp; hi</h1><p>Temporary Password: NEVER-SHOW</p><p>/api/broker-confirm/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</p>${"long ".repeat(100)}` });
  assert.ok(preview.length <= 200);
  assert.ok(!/[<>]/.test(preview));
  assert.ok(!preview.includes("NEVER-SHOW") && !preview.includes("aaaaaaaa") && !preview.includes("secret"));
  assert.ok(preview.includes("[redacted]"));
});
test("request attribution is resolved after authentication; background sends have no staff actor", async () => {
  assert.equal(currentEmailActor(), null);
  const req: any = {};
  const actor = await new Promise<string | null>(resolve => emailActorContext(req, {} as any, () => {
    req.user = { id: "authenticated-staff-fixture" };
    setImmediate(() => resolve(currentEmailActor()));
  }));
  assert.equal(actor, "authenticated-staff-fixture");
  assert.equal(currentEmailActor(), null);
});
test("a failed pre-send audit insert never calls the provider", async () => {
  let calls = 0;
  const transport = createResendTransport(async () => { calls++; return new Response('{"id":"never"}'); }, 30000, {
    async begin() { throw new Error("Audit storage unavailable"); }, async accepted() {}, async failed() {},
  });
  await assert.rejects(transport(message()), /Audit storage unavailable/);
  assert.equal(calls, 0);
});
test("Svix verifies original bytes, rotation signatures and skew; rejects tampering, unsigned and stale events", () => {
  const raw = Buffer.from('{"type":"email.delivered","note":"UTF-8: café"}');
  const headers = signature(raw, "fixture-event");
  assert.equal((verifyResendWebhook(raw, headers, testSecret) as any).type, "email.delivered");
  assert.equal((verifyResendWebhook(raw, { ...headers, signature: `v1,invalid ${headers.signature}` }, testSecret) as any).type, "email.delivered");
  assert.throws(() => verifyResendWebhook(Buffer.from(raw.toString() + " "), headers, testSecret));
  assert.throws(() => verifyResendWebhook(raw, {}, testSecret));
  assert.throws(() => verifyResendWebhook(raw, signature(raw, "fixture-event", String(Math.floor(Date.now() / 1000) - 600)), testSecret));
});
test("transport inserts before sending, preserves envelope/CC/attachment metadata, encrypts retry HTML and never exposes it", async () => fixture(async store => {
  let id = 0, calls = 0;
  const uploads = new Map<string, Buffer>();
  const recorder = createEmailLogRecorder({ store, upload: async (buffer, key) => { uploads.set(key, buffer); return key; } });
  const params = { ...message(), attachments: [{ filename: "invoice.pdf", content: Buffer.from("test pdf").toString("base64"), type: "application/pdf" }] };
  const send = createResendTransport(async (_connector, _path, options) => {
    calls++;
    const [row] = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject));
    id = row.id;
    assert.equal(row.status, "failed");
    const [payload] = await store.select().from(emailRetryPayloads).where(eq(emailRetryPayloads.emailLogId, id));
    assert.ok(payload.encryptedPayload && !payload.encryptedPayload.includes("<h1>") && !payload.encryptedPayload.includes("Please review"));
    assert.deepEqual((options.body as any).cc, params.cc);
    return new Response(JSON.stringify({ id: `provider-${id}` }));
  }, 30000, recorder);
  assert.equal(await send(params), `provider-${id}`);
  const detail = await readEmailLog(id, false, store);
  assert.equal(detail.status, "sent");
  assert.equal(detail.sentByName, "System");
  assert.equal(detail.entityUrl, "/invoices/123");
  assert.equal(detail.attachments[0].size, 8);
  assert.equal(uploads.get(detail.attachments[0].s3_key!)?.toString(), "test pdf");
  assert.equal(detail.canResend, false);
  assert.ok(!JSON.stringify(detail).includes("encryptedPayload"));
  assert.ok(!JSON.stringify(detail).includes("<h1>"));
  // Durable acceptance prevents an unchanged intent being sent twice, even
  // after the provider's idempotency cache eventually expires.
  await send(params);
  assert.equal(calls, 1);
}));
test("provider failure stays failed; retry claims serialize and a retry of a retry uses the root intent", async () => fixture(async store => {
  const params = message();
  const recorder = createEmailLogRecorder({ store, upload: async (_bytes, key) => key });
  const fail = createResendTransport(async () => new Response(JSON.stringify({ message: "Rejected fixture" }), { status: 403 }), 30000, recorder);
  await assert.rejects(fail(params), /Rejected fixture/);
  const [first] = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject));
  assert.equal(first.status, "failed");
  assert.match(first.error!, /Rejected fixture/);
  const claim = await claimEmailRetry(first.id, store);
  await assert.rejects(claimEmailRetry(first.id, store), /still being sent/);
  await assert.rejects(fail({ ...claim.params, emailLog: { ...claim.params.emailLog, retryOfId: first.id } }));
  const attempts = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject));
  const child = attempts.find(row => row.id !== first.id)!;
  const second = await claimEmailRetry(child.id, store);
  assert.equal(second.rootId, first.id);
  const accepted = createResendTransport(async () => new Response(JSON.stringify({ id: "retry-accepted" })), 30000, recorder);
  await accepted({ ...second.params, emailLog: { ...second.params.emailLog, retryOfId: second.rootId } });
  await assert.rejects(claimEmailRetry(first.id, store), /Already resent|Only failed|already accepted/);
  await assert.rejects(claimEmailRetry(child.id, store), /Already resent|Only failed|already accepted/);
}));
test("webhooks reconcile before acceptance and after lost responses; duplicate/late events cannot regress terminal status", async () => fixture(async store => {
  const params = message(), recorder = createEmailLogRecorder({ store });
  let id = 0, correlation = "";
  const providerId = `provider-${randomUUID()}`;
  const send = createResendTransport(async (_c, _p, options) => {
    correlation = (options.body as any).tags[0].value;
    const [row] = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject)); id = row.id;
    await processResendEvent(`fixture-${randomUUID()}`, { type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: providerId, tags: { email_log_key: correlation } } }, store);
    throw new Error("Lost acceptance response");
  }, 30000, recorder);
  await assert.rejects(send(params), /could not be confirmed/);
  assert.equal((await readEmailLog(id, true, store)).status, "delivered");
  const complaintId = `fixture-${randomUUID()}`;
  const complaint = { type: "email.complained", created_at: new Date().toISOString(), data: { email_id: providerId } };
  await processResendEvent(complaintId, complaint, store);
  assert.deepEqual(await processResendEvent(complaintId, complaint, store), { duplicate: true });
  await processResendEvent(`fixture-${randomUUID()}`, { type: "email.sent", created_at: new Date().toISOString(), data: { email_id: providerId } }, store);
  assert.equal((await readEmailLog(id, true, store)).status, "complained");
  assert.equal((await readEmailLog(id, true, store)).events.filter(e => e.type === "email.complained").length, 1);
}));
test("storage failure sends nothing and remains retryable; old uncertain delivery cannot be blindly resent", async () => fixture(async store => {
  let providerCalls = 0;
  const recorder = createEmailLogRecorder({ store, upload: async () => { throw new Error("Storage unavailable"); } });
  const params = { ...message(), attachments: [{ filename: "fixture.pdf", content: "dGVzdA==" }] };
  await assert.rejects(createResendTransport(async () => { providerCalls++; return new Response('{"id":"unused"}'); }, 30000, recorder)(params), /storage failed/);
  assert.equal(providerCalls, 0);
  const [row] = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject));
  assert.equal((await readEmailLog(row.id, true, store)).canResend, true);
  await store.update(emailRetryPayloads).set({ uncertain: true, createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(emailRetryPayloads.emailLogId, row.id));
  await assert.rejects(claimEmailRetry(row.id, store), /safe retry window has expired/);
}));
test("filters handle literal recipient/subject text and Denver calendar dates, not UTC day boundaries", async () => fixture(async store => {
  const params = { ...message(), subject: `calendar-${randomUUID()}-%_`, text: "Calendar fixture" };
  const recorder = createEmailLogRecorder({ store, now: () => new Date("2026-11-01T05:30:00Z") });
  await createResendTransport(async () => new Response('{"id":"calendar-provider"}'), 30000, recorder)(params);
  assert.equal((await listEmailLog({ q: params.subject, from: "2026-10-31", to: "2026-10-31", status: "sent", agentId: "system", entityType: "invoice" }, false, store)).total, 1);
  assert.equal((await listEmailLog({ q: params.subject, from: "2026-11-01", to: "2026-11-01" }, false, store)).total, 0);
  await assert.rejects(listEmailLog({ from: "2026-02-30" }, false, store));
}));
test("HTTP endpoints allow staff reads, reject staff retries/edits, verify public webhook and return scoped attachment downloads", async () => fixture(async store => {
  const params = { ...message(), attachments: [{ filename: "fixture.pdf", content: "dGVzdA==" }] };
  const recorder = createEmailLogRecorder({ store, upload: async (_bytes, key) => key });
  const send = createResendTransport(async () => new Response('{"id":"http-retry-provider"}'), 30000, recorder);
  await assert.rejects(createResendTransport(async () => new Response('{"message":"fixture rejected"}', { status: 403 }), 30000, recorder)(params));
  const [row] = await store.select().from(emailLog).where(eq(emailLog.subject, params.subject));
  const app = express();
  app.use(express.json({ verify(req: any, _res, body) { req.rawBody = body; } }));
  const auth: express.RequestHandler = (req: any, res, next) => {
    if (!req.get("x-fixture-role")) return void res.status(401).json({ message: "Unauthorized" });
    req.user = { id: "isolated-fixture-user", role: req.get("x-fixture-role"), permissions: [] }; next();
  };
  registerEmailLogRoutes(app, { store, send, requireAuth: auth,
    requireManagerOrAdmin: (req: any, res, next) => ["manager", "admin"].includes(req.user.role) ? next() : void res.status(403).json({ message: "Forbidden" }),
    signingSecret: () => testSecret, signedDownload: async () => "https://example.test/fixture-download" });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const staff = { "x-fixture-role": "employee", "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/email-log`)).status, 401);
    assert.equal((await fetch(`${base}/api/email-log/summary`)).status, 401);
    assert.equal((await fetch(`${base}/api/email-log`, { headers: staff })).status, 200);
    const summary = await fetch(`${base}/api/email-log/summary?q=${encodeURIComponent(params.subject)}`, { headers: staff });
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).totals.failed, 1);
    assert.equal((await fetch(`${base}/api/email-log/summary?from=2026-02-30`, { headers: staff })).status, 400);
    assert.equal((await fetch(`${base}/api/email-log/agents`, { headers: staff })).status, 200);
    assert.equal((await fetch(`${base}/api/email-log/integration-status`, { headers: staff })).status, 200);
    assert.equal((await fetch(`${base}/api/email-log/${row.id}/resend`, { method: "POST", headers: staff, body: "{}" })).status, 403);
    for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await fetch(`${base}/api/email-log/${row.id}`, { method, headers: staff, body: "{}" })).status, 405);
    assert.equal((await fetch(`${base}/api/email-log/${row.id}/attachments/999`, { headers: staff, redirect: "manual" })).status, 404);
    const download = await fetch(`${base}/api/email-log/${row.id}/attachments/0`, { headers: staff, redirect: "manual" });
    assert.equal(download.status, 302);
    assert.equal(download.headers.get("location"), "https://example.test/fixture-download");
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${base}/api/email-log/${row.id}/attachments/0`, { redirect: "manual" })).status, 401);
    assert.equal((await fetch(`${base}/api/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    const response = await fetch(`${base}/api/email-log/${row.id}/resend`, { method: "POST", headers: { ...staff, "x-fixture-role": "manager" }, body: "{}" });
    assert.equal(response.status, 200, await response.clone().text());
    const retry = await response.json() as { emailLogId: number };
    assert.notEqual(retry.emailLogId, row.id);
    const raw = Buffer.from(JSON.stringify({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "http-retry-provider", bounce: { message: "Mailbox does not exist" } } }));
    const signed = signature(raw, `fixture-${randomUUID()}`);
    const eventResponse = await fetch(`${base}/api/webhooks/resend`, { method: "POST", headers: { "Content-Type": "application/json", "svix-id": signed.id, "svix-timestamp": signed.timestamp, "svix-signature": signed.signature }, body: raw });
    assert.equal(eventResponse.status, 200);
    assert.equal((await readEmailLog(retry.emailLogId, true, store)).status, "bounced");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}));

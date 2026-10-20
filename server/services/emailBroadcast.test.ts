import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, users, emailBroadcasts, emailBroadcastRecipients, emailBroadcastDispatch } from "@shared/schema";
import { broadcastDraftSchema } from "@shared/email-broadcast";
import { createResendTransport, ResendDeliveryError } from "../resendTransport.js";
import { createEmailBroadcastService, planBroadcastRecipients, BROADCAST_GAP_MS } from "./emailBroadcast";
import { registerEmailBroadcastRoutes } from "../routes/emailBroadcast";

after(async () => { await pool.end(); });
const rollback = new Error("rollback broadcast fixtures");
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test("recipient planning rejects invalid addresses, deduplicates, and forbids envelope overrides", () => {
  const planned = planBroadcastRecipients([
    { id: 1, name: "One", email: " Test@Example.com " }, { id: 2, name: "Two", email: "test@example.com" },
    { id: 3, name: "Bad", email: "bad" }, { id: 4, name: "Empty", email: null },
    { id: 5, name: "Injection", email: "valid@example.com\r\nBcc: other@example.com" },
  ]);
  assert.equal(planned[0].email, "test@example.com");
  assert.deepEqual(planned.map(row => row.status), ["pending", "skipped", "skipped", "skipped", "skipped"]);
  for (const extra of [{ cc: ["outside@example.com"] }, { bcc: ["outside@example.com"] }, { to: "outside@example.com" }]) {
    assert.throws(() => broadcastDraftSchema.parse({ requestId: randomUUID(), subject: "Message", body: "Text", ...extra }));
  }
});

test("durable broadcast: admin scope, exact confirmation, privacy, real spacing, isolated failure, resume and JSON routes", async () => {
  await assert.rejects(db.transaction(async tx => {
    const marker = `broadcast-fixture-${randomUUID()}`;
    const [admin, employee, manager] = await tx.insert(users).values([
      { id: `${marker}-admin`, firstName: "Broadcast", lastName: "Admin", role: "admin", status: "active", isTestAccount: true },
      { id: `${marker}-employee`, firstName: "Employee", role: "employee", status: "active", isTestAccount: true },
      { id: `${marker}-manager`, firstName: "Manager", role: "manager", status: "active", isTestAccount: true },
    ]).returning();
    const fixtureClients = await tx.insert(clients).values([
      { name: `${marker} One`, email: "one@example.test", status: "active", assignedProcessor: employee.id },
      { name: `${marker} Two`, email: "two@example.test", status: "active", assignedProcessor: employee.id },
      { name: `${marker} Three`, email: "three@example.test", status: "active" },
      { name: `${marker} Invalid`, email: "invalid", status: "active" },
      { name: `${marker} Duplicate`, email: " ONE@example.test ", status: "active" },
      { name: `${marker} Inactive`, email: "inactive@example.test", status: "inactive" },
    ]).returning();
    const captures: any[] = [];
    const started: number[] = [];
    const recorder = { async begin() { return 1; }, async accepted() {}, async failed() {} };
    const sender = createResendTransport(async (_connector, path, options) => {
      assert.equal(path, "/emails");
      started.push(Date.now());
      captures.push(options);
      if (captures.length === 2) return new Response(JSON.stringify({ message: "Isolated provider failure" }), { status: 400 });
      return new Response(JSON.stringify({ id: `broadcast-provider-${captures.length}` }), { status: 200 });
    }, 30000, recorder);
    const service = createEmailBroadcastService({ database: tx, send: sender });
    for (const actor of [employee.id, manager.id]) {
      await assert.rejects(service.recipients(actor, {}), /administrators only/);
      await assert.rejects(service.preview(actor, {}), /administrators only/);
      await assert.rejects(service.list(actor), /administrators only/);
    }
    const filters = { search: marker, status: "active" as const };
    const audience = await service.recipients(admin.id, filters);
    assert.deepEqual(audience.counts, { matched: 5, sendable: 3, skipped: 2 });
    assert.equal((await service.recipients(admin.id, { ...filters, assignedProcessor: employee.id })).counts.sendable, 2);
    assert.equal((await service.recipients(admin.id, { search: marker })).counts.matched, 6);
    const input = { requestId: randomUUID(), subject: "Private test", body: "One shared message, separate deliveries.", filters };
    const preview = await service.preview(admin.id, input);
    const id = preview.broadcast.id;
    assert.equal(preview.broadcast.status, "draft");
    assert.equal(preview.broadcast.counts.skipped, 2);
    assert.equal((await service.preview(admin.id, input)).broadcast.id, id);
    await assert.rejects(service.preview(admin.id, { ...input, body: "Different message" }), /different broadcast/);
    assert.equal(captures.length, 0, "preview must never send");
    await assert.rejects(service.confirm(employee.id, id, 3), /administrators only/);
    await assert.rejects(service.confirm(admin.id, id, 4), /Recipient count changed/);
    await tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) });
    await service.tick();
    assert.equal(captures.length, 0, "unconfirmed draft must never send");
    assert.equal((await service.confirm(admin.id, id, 3)).broadcast.status, "queued");
    await service.confirm(admin.id, id, 3);
    assert.equal(await service.tick(), true);
    assert.equal(captures.length, 1);
    assert.equal(await service.tick(), false, "global throttle rejects immediate next send");
    await delay(BROADCAST_GAP_MS + 100);
    assert.equal(await service.tick(), true);
    assert(started[1] - started[0] >= BROADCAST_GAP_MS);
    let progress = await service.read(admin.id, id);
    assert.equal(progress.broadcast.counts.failed, 1);
    const [backoff] = await tx.select().from(emailBroadcastDispatch);
    assert(backoff.nextSendAt.getTime() - Date.now() >= 28000, "failure backs off for 30 seconds");
    // Simulate time passing without waiting for the provider-error backoff.
    await tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) });
    const resumed = createEmailBroadcastService({ database: tx, send: sender });
    await resumed.tick();
    progress = await resumed.read(admin.id, id);
    assert.equal(progress.broadcast.status, "completed");
    assert.deepEqual(progress.broadcast.counts, { total: 5, sendable: 3, skipped: 2, pending: 0, sent: 2, failed: 1, unconfirmed: 0 });
    await resumed.tick();
    assert.equal(captures.length, 3, "completed job cannot resend");
    assert.equal(new Set(captures.map(capture => capture.headers["Idempotency-Key"])).size, 3);
    for (const capture of captures) {
      assert.equal(capture.body.to.length, 1);
      assert.equal(capture.body.cc, undefined);
      assert.equal(capture.body.bcc, undefined);
      assert.equal(capture.body.from, "Trucking Pros Financial <notifications@truckingprosfinancial.com>");
      assert.equal(capture.body.reply_to, "dosh@truckingprosfinancial.com");
      assert.match(capture.body.html, /data-tpf-email="1"/);
    }
    assert.deepEqual(captures.map(capture => capture.body.to[0]), ["one@example.test", "two@example.test", "three@example.test"]);
    assert(progress.recipients.filter(row => row.status === "sent").every(row => row.providerMessageId && row.sentAt));
    assert(progress.recipients.find(row => row.status === "failed")?.error?.includes("Isolated provider failure"));

    // DB advisory mutex works across connections/processes, not just JS timers.
    const secondProcess = createEmailBroadcastService({ send: async () => { throw Error("Should never send while locked"); } });
    assert.equal(await secondProcess.tick(), false);

    const app = express(); app.use(express.json());
    registerEmailBroadcastRoutes(app, {
      service,
      requireAuth(req: any, _res, next) { req.user = { id: req.header("x-test-user") }; next(); },
      // Even a delegated-manager middleware bypass cannot pass service-level role validation.
      requireAdmin(_req, _res, next) { next(); },
    });
    app.use((_req, res) => res.type("html").send("<!DOCTYPE html>SPA"));
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const port = (server.address() as { port: number }).port;
    try {
      for (const actor of [employee.id, manager.id]) {
        for (const [method, path, body] of [
          ["GET", "/options", null], ["GET", "/recipients", null], ["GET", "", null], ["GET", `/${id}`, null],
          ["POST", "/preview", input], ["POST", `/${id}/confirm`, { recipientCount: 3 }], ["POST", `/${id}/cancel`, {}],
        ] as const) {
          const response = await fetch(`http://127.0.0.1:${port}/api/email-broadcasts${path}`, {
            method, headers: { "x-test-user": actor, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
          });
          assert.equal(response.status, 403);
          assert.match(response.headers.get("content-type")!, /json/);
          assert.match((await response.json()).message, /administrators only/);
        }
      }
      const ok = await fetch(`http://127.0.0.1:${port}/api/email-broadcasts/${id}`, { headers: { "x-test-user": admin.id } });
      assert.equal(ok.status, 200); assert.equal((await ok.json()).broadcast.counts.sent, 2);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    throw rollback;
  }), error => error === rollback);
});

test("stale previews, cancelled/expired jobs, recipient changes, uncertainty and revoked senders are safe", async () => {
  await assert.rejects(db.transaction(async tx => {
    const marker = `broadcast-safety-${randomUUID()}`;
    const [actor] = await tx.insert(users).values({ id: marker, role: "admin", status: "active", isTestAccount: true }).returning();
    const [client] = await tx.insert(clients).values({ name: marker, email: "first@example.test", status: "active" }).returning();
    let calls = 0;
    const service = createEmailBroadcastService({ database: tx, send: async () => { calls++; throw new ResendDeliveryError(503, "Unconfirmed transport", true); } });
    const draft = () => ({ requestId: randomUUID(), subject: "Safety", body: "No real emails", filters: { search: marker } });
    let preview = await service.preview(actor.id, draft());
    await tx.update(clients).set({ email: "changed@example.test" }).where(eq(clients.id, client.id));
    await assert.rejects(service.confirm(actor.id, preview.broadcast.id, 1), /Recipients changed/);
    preview = await service.preview(actor.id, draft());
    await tx.update(emailBroadcasts).set({ createdAt: new Date(Date.now() - 31 * 60000) }).where(eq(emailBroadcasts.id, preview.broadcast.id));
    await assert.rejects(service.confirm(actor.id, preview.broadcast.id, 1), /Preview expired/);
    preview = await service.preview(actor.id, draft());
    await service.confirm(actor.id, preview.broadcast.id, 1);
    await service.cancel(actor.id, preview.broadcast.id);
    await tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) });
    await service.tick(); assert.equal(calls, 0);
    preview = await service.preview(actor.id, draft());
    await service.confirm(actor.id, preview.broadcast.id, 1);
    await service.tick();
    assert.equal((await service.read(actor.id, preview.broadcast.id)).broadcast.counts.unconfirmed, 1);
    await service.tick(); assert.equal(calls, 1, "ambiguous delivery must not automatically resend");
    preview = await service.preview(actor.id, draft());
    await service.confirm(actor.id, preview.broadcast.id, 1);
    await tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) });
    await tx.update(clients).set({ email: "new@example.test" }).where(eq(clients.id, client.id));
    await service.tick();
    assert.match((await service.read(actor.id, preview.broadcast.id)).recipients[0].error!, /email changed/);
    await service.tick();
    preview = await service.preview(actor.id, draft());
    await service.confirm(actor.id, preview.broadcast.id, 1);
    await tx.update(users).set({ role: "employee" }).where(eq(users.id, actor.id));
    await service.tick();
    const [failed] = await tx.select().from(emailBroadcastRecipients).where(eq(emailBroadcastRecipients.broadcastId, preview.broadcast.id));
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /no longer an active administrator/);
    assert.equal(calls, 1);
    throw rollback;
  }), error => error === rollback);
});

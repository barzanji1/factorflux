import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import express from "express";
import { db, pool } from "../db";
import { brokers, clients, users, invoices, notifications, emailLog,
  brokerCollectionStates as states, brokerCollectionEvents as events,
  brokerCollectionSettings as settings, brokerConfirmationSettings } from "../../shared/schema";
import { COLLECTION_DAY as DAY, createBrokerCollectionsService, ensureCollectionState, nextCollectionAction } from "./brokerCollections";
import { createResendTransport } from "../resendTransport.js";
import { createEmailLogRecorder } from "./emailLogService";
import { validateEmailRetryDomain } from "./emailLogReconciliation";
import { registerBrokerCollectionsRoutes } from "../routes/brokerCollections";

after(() => pool.end());
const funded = new Date("2027-01-01T00:00:00Z");
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function fixture(tx: Tx) {
  const tag = randomUUID();
  const employee = `collections-agent-${tag}`, admin = `collections-admin-${tag}`, alan = `collections-escalation-${tag}`, outsider = `collections-outsider-${tag}`;
  await tx.insert(users).values([
    { id: employee, firstName: "Fixture", lastName: "Agent", role: "employee", status: "active" },
    { id: admin, firstName: "Fixture", lastName: "Admin", role: "admin", status: "active" },
    { id: alan, firstName: "Fixture", lastName: "Escalation", role: "manager", status: "active" },
    { id: outsider, firstName: "Fixture", lastName: "Outsider", role: "employee", status: "active" },
  ]);
  const [carrier] = await tx.insert(clients).values({ name: `COLLECTIONS FIXTURE ${tag}`, assignedProcessor: employee, dataOrigin: "pilot" }).returning();
  const [broker] = await tx.insert(brokers).values({ name: `COLLECTIONS BROKER ${tag}`, email: "broker@example.test",
    contactPerson: "Fixture", phone: "000-000-0000", dataOrigin: "pilot" }).returning();
  await tx.update(settings).set({ enabled: false, mode: "dry_run", nextSendAt: new Date(0) }).where(eq(settings.id, 1));
  await tx.update(brokerConfirmationSettings).set({ publicBaseUrl: "https://collections.example.test" }).where(eq(brokerConfirmationSettings.id, 1));
  const invoice = async (suffix = "", extra: Partial<typeof invoices.$inferInsert> = {}) => (await tx.insert(invoices).values({
    invoiceNumber: `COLLECTIONS-${tag}${suffix}`, loadNumber: `LOAD-${tag}${suffix}`, loadId: null,
    clientId: carrier.id, brokerId: broker.id, amount: "1500", status: "funded", fundedAt: funded,
    submittedBy: employee, assignedFollowupAgentId: employee, ...extra,
  }).returning())[0];
  return { employee, admin, alan, outsider, invoice, broker };
}
async function rolledBack(work: (tx: Tx) => Promise<void>) {
  const rollback = new Error("rollback collections fixture");
  await assert.rejects(db.transaction(async tx => { await work(tx); throw rollback; }), error => error === rollback);
}

test("phase action planner is bounded and terminal/escalated workflows do not schedule", () => {
  assert.equal(nextCollectionAction({ phase: "vp", vpAttempts: 0, rpsAttempts: 0, escalatedPhase: null })?.step, "vp_1");
  assert.equal(nextCollectionAction({ phase: "rps", vpAttempts: 2, rpsAttempts: 3, escalatedPhase: null })?.step, "rps_escalation");
  for (const phase of ["paid", "stopped"] as const) assert.equal(nextCollectionAction({ phase, vpAttempts: 0, rpsAttempts: 0, escalatedPhase: null }), null);
  assert.equal(nextCollectionAction({ phase: "vp", vpAttempts: 2, rpsAttempts: 0, escalatedPhase: "vp" }), null);
});

for (const mode of ["dry_run", "live"] as const) test(`${mode}: funded → +48h/+96h → VP call → agent confirms → day20/35/40 → RPS call → paid (rollback, fake transport)`, async () => {
  await rolledBack(async tx => {
    const f = await fixture(tx);
    let clock = new Date(funded);
    const captured: any[] = [];
    const transport = createResendTransport(async (_connector, _path, request) => {
      captured.push(request.body);
      return new Response(JSON.stringify({ id: `collections-provider-${captured.length}` }), { status: 200 });
    }, 30000, createEmailLogRecorder(tx));
    const service = createBrokerCollectionsService({ database: tx, now: () => new Date(clock),
      send: mode === "live" ? transport : async () => { throw new Error("DRY RUN MUST NEVER CALL TRANSPORT"); },
      escalationRecipient: async () => f.alan });
    await service.updateSettings(f.admin, { enabled: true, mode, ...(mode === "live" ? { confirmLive: true } : {}) });
    const invoice = await f.invoice();
    await ensureCollectionState(tx, invoice, clock);
    const tickAt = async (at: number) => { clock = new Date(at); return service.tick({ invoiceIds: [invoice.id] }); };
    assert.equal((await tickAt(funded.getTime() + 2 * DAY - 1)).processed, 0);
    await tickAt(funded.getTime() + 2 * DAY);
    assert.equal((await service.detail(f.employee, invoice.id)).row.vpAttempts, 1);
    assert.equal((await tickAt(clock.getTime())).processed, 0, "same time never repeats a step");
    await tickAt(funded.getTime() + 4 * DAY);
    await tickAt(clock.getTime()); // Escalation follows acceptance of the second reminder.
    let detail = await service.detail(f.employee, invoice.id);
    assert.equal(detail.row.escalatedPhase, "vp");
    assert.equal(detail.row.nextActionAt, null);
    await service.action(f.employee, invoice.id, { action: "vp_confirmed" });
    const vpAt = clock.getTime();
    assert.equal((await service.detail(f.employee, invoice.id)).row.phase, "rps");
    assert.equal((await tickAt(vpAt + 20 * DAY - 1)).processed, 0);
    for (const day of [20, 35, 40]) await tickAt(vpAt + day * DAY);
    await tickAt(clock.getTime());
    detail = await service.detail(f.employee, invoice.id);
    assert.equal(detail.row.rpsAttempts, 3);
    assert.equal(detail.row.escalatedPhase, "rps");
    const notices = await tx.select().from(notifications).where(and(eq(notifications.entityId, invoice.id), eq(notifications.userId, f.alan)));
    assert.equal(notices.length, mode === "live" ? 2 : 0, "dry-run must not ring the real bell");
    if (mode === "live") {
      assert(notices[0].message.includes(invoice.loadNumber!));
      assert(notices[0].message.includes("VP — confirm receipt"));
      assert(notices[1].message.includes("RPS — payment status"));
    }
    const automated = detail.events.filter(event => !event.step.startsWith("control_"));
    assert.equal(automated.length, 7);
    assert(automated.every(event => event.mode === mode && event.outcome === (mode === "dry_run" ? "simulated" : event.step.includes("escalation") ? "notified" : "sent")));
    assert.equal(captured.length, mode === "live" ? 5 : 0);
    if (mode === "live") {
      assert(captured.every(payload => payload.to.length === 1 && payload.to[0] === "broker@example.test" && !payload.cc && !payload.bcc));
      assert(captured.every(payload => payload.from.includes("notifications@truckingprosfinancial.com") && payload.reply_to === "dosh@truckingprosfinancial.com"));
      assert(captured[0].html.includes("Trucking Pros Financial"));
      assert(captured[0].html.includes("/api/broker-confirm/"));
      const logs = await tx.select().from(emailLog).where(and(eq(emailLog.entityType, "invoice"), eq(emailLog.entityId, String(invoice.id))));
      assert.equal(logs.length, 5, "every real-transport send goes through the shared Email Log");
    }
    await service.action(f.employee, invoice.id, { action: "paid" });
    assert.equal((await tickAt(vpAt + 80 * DAY)).processed, 0);
    assert.equal((await service.detail(f.employee, invoice.id)).row.phase, "paid");
    const [financialInvoice] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    assert.equal(financialInvoice.status, "funded", "collection paid marker must not invent cash or accounting postings");
    console.log(JSON.stringify({ mode, vp: [48, 96], rps: [20, 35, 40], events: automated.map(event => ({ step: event.step, outcome: event.outcome })), actualEmails: captured.length, bellNotifications: notices.length, paidStops: true }));
  });
});

test("global off, per-invoice pause/stop, roles, shadow/live isolation, and legacy receipt adoption (rollback)", async () => {
  await rolledBack(async tx => {
    const f = await fixture(tx);
    let clock = new Date(funded.getTime() + 5 * DAY);
    let sends = 0;
    const service = createBrokerCollectionsService({ database: tx, now: () => new Date(clock),
      send: async () => { sends++; return "fixture-provider"; }, escalationRecipient: async () => f.alan });
    const invoice = await f.invoice();
    await service.tick({ invoiceIds: [invoice.id] });
    assert.equal((await service.detail(f.employee, invoice.id)).row.mode, "dry_run");
    assert.equal(sends, 0);
    await assert.rejects(service.updateSettings(f.employee, { enabled: true, mode: "dry_run" }), /Administrators only/);
    await assert.rejects(service.detail(f.outsider, invoice.id), /assigned scope/);
    await assert.rejects(service.action(f.outsider, invoice.id, { action: "paid" }), /assigned scope/);
    await assert.rejects(service.updateSettings(f.admin, { enabled: true, mode: "live" }), /Explicitly confirm/);
    await service.updateSettings(f.admin, { enabled: true, mode: "dry_run" });
    await service.action(f.employee, invoice.id, { action: "pause" });
    assert.equal((await service.tick({ invoiceIds: [invoice.id] })).processed, 0);
    await service.action(f.employee, invoice.id, { action: "resume" });
    await service.tick({ invoiceIds: [invoice.id] });
    await service.updateSettings(f.admin, { enabled: true, mode: "live", confirmLive: true });
    assert.equal((await service.detail(f.employee, invoice.id)).row.mode, "dry_run", "global live never converts simulated progress");
    await assert.rejects(service.action(f.employee, invoice.id, { action: "start_live", confirmLive: true }), /Administrators only/);
    await service.action(f.admin, invoice.id, { action: "start_live", confirmLive: true });
    await service.tick({ invoiceIds: [invoice.id] });
    assert.equal(sends, 1);
    await service.updateSettings(f.admin, { enabled: true, mode: "dry_run" });
    clock = new Date(clock.getTime() + 3 * DAY);
    await service.tick({ invoiceIds: [invoice.id] });
    assert.equal(sends, 1, "dry-run global mode cannot send an existing live workflow");
    await service.action(f.employee, invoice.id, { action: "stop" });
    await assert.rejects(service.action(f.employee, invoice.id, { action: "resume" }), /already stopped/);
    await service.updateSettings(f.admin, { enabled: true, mode: "live", confirmLive: true });
    const adopted = await f.invoice("-adopt", { confirmationSentAt: new Date(funded.getTime() + 2 * DAY), brokerConfirmationStatus: "sent" });
    await ensureCollectionState(tx, adopted, clock);
    assert.equal((await service.detail(f.employee, adopted.id)).row.vpAttempts, 1, "existing +48h receipt request is not duplicated");
    const locked = await pool.query("select pg_try_advisory_lock(82651074) as acquired");
    assert.equal(locked.rows[0].acquired, false, "other processes cannot take the delivery lease");
    await assert.rejects(validateEmailRetryDomain({ to: "broker@example.test", subject: "test",
      emailLog: { templateName: "broker_collections_vp", entityId: invoice.id } }, tx), /cannot bypass/);
  });
});

test("provider failures pause visibly; retries reuse the same intent, and HTTP errors stay JSON (rollback)", async () => {
  await rolledBack(async tx => {
    const f = await fixture(tx);
    const invoice = await f.invoice();
    let fail = true;
    const keys: string[] = [];
    const service = createBrokerCollectionsService({ database: tx, now: () => new Date(funded.getTime() + 2 * DAY),
      send: async params => { keys.push(params.idempotencyKey!); if (fail) throw new Error("Provider AccessDenied fixture"); return "retry-provider"; } });
    await service.updateSettings(f.admin, { enabled: true, mode: "live", confirmLive: true });
    await service.tick({ invoiceIds: [invoice.id] });
    let detail = await service.detail(f.employee, invoice.id);
    assert.equal(detail.row.paused, true);
    assert.match(detail.row.lastError!, /AccessDenied/);
    assert.equal(detail.events[0].outcome, "failed");
    assert.equal(detail.row.vpAttempts, 0);
    await service.tick({ invoiceIds: [invoice.id] });
    assert.equal(keys.length, 1);
    fail = false;
    await service.action(f.employee, invoice.id, { action: "resume" });
    await service.tick({ invoiceIds: [invoice.id] });
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    detail = await service.detail(f.employee, invoice.id);
    assert.equal(detail.row.vpAttempts, 1);
    const app = express(); app.use(express.json());
    registerBrokerCollectionsRoutes(app, { service, requireAuth: (req: any, _res, next) => { req.user = { id: req.headers["x-actor"] ?? f.employee }; next(); } });
    app.use((_req, res) => res.type("html").send("<!DOCTYPE html>SPA"));
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/broker-collections/${invoice.id}/action`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-actor": f.outsider }, body: JSON.stringify({ action: "paid" }) });
      assert.equal(response.status, 404);
      assert(response.headers.get("content-type")?.includes("application/json"));
      const denied = await fetch(`http://127.0.0.1:${port}/api/broker-collections/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(denied.status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/broker-collections?phase=vp`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/broker-collections/settings`)).status, 200);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

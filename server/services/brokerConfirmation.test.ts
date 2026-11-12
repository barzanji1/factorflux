import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createResendTransport } from "../resendTransport.js";
import { createEmailLogRecorder, processResendEvent } from "./emailLogService";
import { reconcileResendMessage } from "./emailLogReconciliation";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  brokers, clients, users, invoices, documents, tasks, brokerConfirmationEvents, eventLedger,
  insertInvoiceSchema, insertTaskSchema, brokerConfirmationSettings,
} from "../../shared/schema";
import { createBrokerConfirmationService, confirmationAction, fundedAgeDays, getConfirmationAgingRows, getConfirmationInvoiceScope } from "./brokerConfirmationService";
import { registerBrokerConfirmationRoutes, confirmationSettingsSchema } from "../routes/brokerConfirmation";
import { runInvoicePreflight } from "./invoicePreflight";

const DAY = 86_400_000;
const config = { maxReminders: 3, reminderDays: [3, 7, 14] as [number, number, number], publicBaseUrl: "https://factorflux.co" };
const at = new Date("2026-10-12T18:00:00Z");
const base = { status: "funded" as const, fundedAt: new Date(at.getTime() - 2 * DAY - 1), brokerConfirmationStatus: "pending" as const, confirmationSentAt: null, confirmationRemindedCount: 0 };

test("confirmation waits over 48 hours and never changes the funding clock", () => {
  assert.equal(confirmationAction(base, config, at), "initial");
  for (const age of [DAY, 2 * DAY - 1, 2 * DAY]) {
    assert.equal(confirmationAction({ ...base, fundedAt: new Date(at.getTime() - age) }, config, at), null);
  }
  assert.equal(confirmationAction({ ...base, status: "approved" }, config, at), null);
  assert.equal(confirmationAction({ ...base, fundedAt: null }, config, at), null);
  for (const status of ["confirmed", "disputed"] as const) assert.equal(confirmationAction({ ...base, brokerConfirmationStatus: status }, config, at), null);
});
test("reminders are due at 3, 7, 14 days from FIRST send; maximum is enforced", () => {
  for (const [count, days] of [[0, 3], [1, 7], [2, 14]]) {
    const invoice = { ...base, confirmationSentAt: at, confirmationRemindedCount: count };
    assert.equal(confirmationAction(invoice, config, new Date(at.getTime() + days * DAY - 1)), null);
    assert.equal(confirmationAction(invoice, config, new Date(at.getTime() + days * DAY)), "reminder");
  }
  assert.equal(confirmationAction({ ...base, confirmationSentAt: at, confirmationRemindedCount: 3 }, config, new Date(at.getTime() + 14 * DAY)), "escalate");
  assert.equal(confirmationAction({ ...base, confirmationSentAt: at }, { ...config, maxReminders: 0 }, new Date(at.getTime() + 14 * DAY)), "escalate");
});
test("Denver calendar-day aging survives daylight saving and ignores confirmation", () => {
  assert.equal(fundedAgeDays(new Date("2026-03-08T06:59:00Z"), new Date("2026-03-09T06:01:00Z")), 2);
  assert.equal(fundedAgeDays(new Date("2026-10-12T17:00:00Z"), at), 0);
});
test("settings reject excess reminders, invalid cadence, preview URLs and credentials", () => {
  assert.equal(confirmationSettingsSchema.safeParse(config).success, true);
  for (const changes of [{ maxReminders: 4 }, { maxReminders: -1 }, { reminderDays: [7, 3, 14] }, { publicBaseUrl: "https://demo.replit.dev" }, { publicBaseUrl: "http://factorflux.co" }, { publicBaseUrl: "https://user:pass@factorflux.co" }]) {
    assert.equal(confirmationSettingsSchema.safeParse({ ...config, ...changes }).success, false);
  }
});
test("ordinary create schemas cannot write confirmation status, token, assignment or task linkage", () => {
  const invoice = insertInvoiceSchema.parse({ invoiceNumber: "schema-fixture", clientId: 1, amount: "1",
    brokerConfirmationStatus: "confirmed", brokerConfirmationToken: randomUUID(), assignedFollowupAgentId: "attacker", confirmationRemindedCount: 99 });
  assert.equal("brokerConfirmationStatus" in invoice, false);
  assert.equal("brokerConfirmationToken" in invoice, false);
  assert.equal("assignedFollowupAgentId" in invoice, false);
  const task = insertTaskSchema.parse({ title: "fixture", type: "followup", confirmationInvoiceId: 99, confirmationKind: "disputed" });
  assert.equal("confirmationInvoiceId" in task, false);
});

class FixtureRollback extends Error {}
test("database and HTTP confirmation lifecycle (transactional fixtures; zero real email)", async t => {
  await assert.rejects(db.transaction(async tx => {
    const suffix = randomUUID();
    const userId = `confirmation-fixture-${suffix}`;
    const managerId = `confirmation-manager-${suffix}`;
    const otherId = `confirmation-other-${suffix}`;
    const inactiveId = `confirmation-inactive-${suffix}`;
    await tx.insert(users).values([
      { id: managerId, email: `${managerId}@example.test`, firstName: "Fixture", lastName: "Manager", role: "manager", status: "active", isTestAccount: false },
      { id: userId, email: `${userId}@example.test`, firstName: "Fixture", lastName: "Agent", role: "employee", status: "active", isTestAccount: false, createdBy: managerId },
      { id: otherId, email: `${otherId}@example.test`, firstName: "Other", lastName: "Agent", role: "employee", status: "active", isTestAccount: false },
      { id: inactiveId, email: `${inactiveId}@example.test`, firstName: "Inactive", role: "employee", status: "inactive", isTestAccount: false },
    ]);
    const [carrier] = await tx.insert(clients).values({ name: `CONFIRMATION FIXTURE ${suffix}`, assignedProcessor: userId }).returning();
    const [broker] = await tx.insert(brokers).values({ name: `CONFIRMATION FIXTURE ${suffix}`, contactPerson: "Fixture",
      email: "confirmation-fixture@example.test", phone: "000-000-0000", dataOrigin: "pilot" }).returning();
    let clock = new Date(at);
    const accepted: Array<{ to: string; subject: string; html?: string; idempotencyKey?: string }> = [];
    let fail = false;
    const service = createBrokerConfirmationService({ store: tx, now: () => new Date(clock), send: async params => {
      accepted.push(params);
      return fail ? { success: false } : { success: true, messageId: `fixture-accepted-${accepted.length}` };
    } });
    await tx.update(brokerConfirmationSettings).set(config).where(eq(brokerConfirmationSettings.id, 1));
    const newInvoice = async (label: string, overrides: Partial<typeof invoices.$inferInsert> = {}) =>
      (await tx.insert(invoices).values({ invoiceNumber: `CONF-${label}-${suffix}`, carrierInvoiceNumber: `CARRIER-${label}`,
        clientId: carrier.id, brokerId: broker.id, loadId: null, loadNumber: `LOAD-${label}`, amount: "1000.00",
        status: "funded", fundedAt: new Date(clock.getTime() - 49 * 3_600_000), submittedBy: userId,
        assignedTo: userId, assignedFollowupAgentId: userId, ...overrides }).returning())[0];
    const stored = async (id: number) => (await tx.select().from(invoices).where(eq(invoices.id, id)))[0];
    const paperwork = async (invoiceId: number) => tx.insert(documents).values(
      (["rate_confirmation", "bol", "lumper_receipt", "other", "driver_id"] as const).map(documentType => ({
        invoiceId, clientId: carrier.id, uploadedBy: userId, documentType,
        originalName: `${documentType}-fixture.pdf`, filename: `${suffix}-${documentType}.pdf`,
        mimeType: "application/pdf", size: 100, s3Key: `fixture/${suffix}/${documentType}.pdf`,
      })),
    ).returning();

    await t.test("scheduled initial send excludes 24h and exactly 48h, and includes over 48h", async () => {
      const young = await newInvoice("delay-24h", { fundedAt: new Date(clock.getTime() - DAY) });
      const boundary = await newInvoice("delay-48h", { fundedAt: new Date(clock.getTime() - 2 * DAY) });
      const due = await newInvoice("delay-over48h", { fundedAt: new Date(clock.getTime() - 2 * DAY - 1) });
      const before = accepted.length;
      const result = await service.runScheduled({ invoiceIds: [young.id, boundary.id, due.id] });
      assert.equal(result.checked, 1); assert.equal(result.processed, 1); assert.deepEqual(result.errors, []);
      assert.equal(accepted.length, before + 1);
      assert.equal((await stored(young.id)).confirmationSentAt, null);
      assert.equal((await stored(boundary.id)).confirmationSentAt, null);
      assert.equal((await stored(due.id)).confirmationSentAt?.getTime(), clock.getTime());
      assert.equal((await stored(due.id)).fundedAt?.getTime(), due.fundedAt?.getTime());
    });
    await t.test("a manually sent confirmation keeps its configured reminder cadence before 48h funding age", async () => {
      const invoice = await newInvoice("early-manual", { fundedAt: new Date(clock) });
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      const first = clock.getTime();
      await tx.update(brokerConfirmationSettings).set({ reminderDays: [1, 7, 14] }).where(eq(brokerConfirmationSettings.id, 1));
      clock = new Date(first + DAY);
      const result = await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(result.processed, 1); assert.deepEqual(result.errors, []);
      const row = await stored(invoice.id);
      assert.equal(row.confirmationRemindedCount, 1); assert.equal(row.confirmationSentAt?.getTime(), first);
      await tx.update(brokerConfirmationSettings).set(config).where(eq(brokerConfirmationSettings.id, 1));
      clock = new Date(first);
    });

    await t.test("Email Log acceptance reconciliation updates confirmation without resending or changing funded age", async () => {
      const invoice = await newInvoice("email-log-retry");
      const before = accepted.length;
      await service.recordEmailRetry(invoice.id, { kind: "agent", id: managerId }, "email-log-accepted-fixture", null);
      const row = await stored(invoice.id);
      assert.equal(row.brokerConfirmationStatus, "sent");
      assert.equal(row.confirmationSentAt?.getTime(), clock.getTime());
      assert.equal(row.fundedAt?.getTime(), invoice.fundedAt?.getTime());
      assert.equal(accepted.length, before);
      await service.recordEmailRetry(invoice.id, { kind: "agent", id: managerId }, "email-log-accepted-fixture", null);
      assert.equal((await stored(invoice.id)).confirmationSentAt?.getTime(), clock.getTime());
      await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(accepted.length, before);
    });

    await t.test("verified webhook repairs a lost broker acceptance response and makes its receipt link usable", async () => {
      const invoice = await newInvoice("webhook-lost-acceptance");
      const recorder = createEmailLogRecorder({ store: tx, now: () => new Date(clock) });
      const messageId = `webhook-acceptance-${suffix}`;
      const send = createResendTransport(async (_connector, _path, options) => {
        const tag = (options.body as any).tags[0].value;
        await processResendEvent(`webhook-event-${suffix}`, {
          type: "email.delivered", created_at: clock.toISOString(),
          data: { email_id: messageId, tags: { email_log_key: tag } },
        }, tx);
        throw new Error("Fixture lost HTTP acceptance");
      }, 30000, recorder);
      await assert.rejects(send({ to: broker.email!, subject: "Fixture broker confirmation", text: "Fixture only",
        idempotencyKey: `webhook-fixture-${suffix}`,
        emailLog: { templateName: "broker_confirmation", entityType: "invoice", entityId: invoice.id,
          confirmationReminder: null, sentByUserId: null } }));
      assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "pending");
      await reconcileResendMessage(messageId, tx);
      const row = await stored(invoice.id);
      assert.equal(row.brokerConfirmationStatus, "sent");
      assert.equal(row.confirmationSentAt?.getTime(), clock.getTime());
      assert.equal(row.fundedAt?.getTime(), invoice.fundedAt?.getTime());
      await service.publicInvoice(row.brokerConfirmationToken);
      await reconcileResendMessage(messageId, tx);
      assert.equal((await stored(invoice.id)).confirmationSentAt?.getTime(), clock.getTime());
    });

    await t.test("automatic initial send is accepted once, has both links and all invoice identifiers", async () => {
      const invoice = await newInvoice("initial");
      const docs = await paperwork(invoice.id);
      const before = accepted.length;
      const result = await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(result.errors.length, 0);
      assert.equal(accepted.length, before + 1);
      const mail = accepted.at(-1)!;
      assert.match(mail.html!, /Confirm Receipt/); assert.match(mail.html!, /Dispute/);
      assert.match(mail.html!, /data-tpf-email="1"/);
      assert.match(mail.html!, /https:\/\/factorflux\.io\/api\/broker-confirm\//);
      assert.match(mail.html!, /<td align="center" bgcolor="#27aab8"[^>]*>\s*<a[^>]*>Confirm Receipt<\/a>/);
      for (const doc of docs) assert.equal(mail.html!.includes(`/documents/${doc.id}/download`), doc.documentType !== "driver_id");
      assert.ok(!mail.html!.includes("https://factorflux.co/"));
      for (const value of [invoice.invoiceNumber, invoice.carrierInvoiceNumber!, invoice.loadNumber!, "1000.00", carrier.name]) assert.ok(mail.html!.includes(value));
      assert.ok(mail.idempotencyKey?.endsWith("/initial"));
      await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(accepted.length, before + 1);
      const sent = await stored(invoice.id);
      assert.equal(sent.brokerConfirmationStatus, "sent");
      assert.equal(sent.fundedAt?.getTime(), invoice.fundedAt?.getTime());
      assert.equal(sent.confirmationSentAt?.getTime(), clock.getTime());
    });
    await t.test("Preview blocks real broker mail with an explicit delivery notice", async () => {
      const invoice = await newInvoice("preview");
      const realTransportService = createBrokerConfirmationService({ store: tx });
      if (process.env.NODE_ENV !== "production") {
        const detail = await realTransportService.details(invoice.id);
        assert.equal(detail.canResend, false); assert.match(detail.deliveryNotice!, /disabled in Preview/);
        await assert.rejects(realTransportService.sendForInvoice(invoice.id, { kind: "agent", id: userId }), /disabled in Preview/);
      }
    });
    await t.test("provider rejection leaves pending, stores no success event, and retries same delivery key", async () => {
      const invoice = await newInvoice("failure");
      fail = true;
      const result = await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(result.errors.length, 1);
      const key = accepted.at(-1)!.idempotencyKey;
      const row = await stored(invoice.id);
      assert.equal(row.brokerConfirmationStatus, "pending"); assert.equal(row.confirmationSentAt, null);
      assert.equal((await tx.select().from(brokerConfirmationEvents).where(eq(brokerConfirmationEvents.invoiceId, invoice.id))).length, 0);
      fail = false;
      await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(accepted.at(-1)!.idempotencyKey, key);
    });
    await t.test("uncertain manual send retries reuse a durable key; a subsequent accepted resend has a new key", async () => {
      const invoice = await newInvoice("manual-failure");
      fail = true;
      await assert.rejects(service.sendForInvoice(invoice.id, { kind: "agent", id: userId }), /Resend did not confirm/);
      const key = accepted.at(-1)!.idempotencyKey;
      fail = false;
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      assert.equal(accepted.at(-1)!.idempotencyKey, key);
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      assert.notEqual(accepted.at(-1)!.idempotencyKey, key);
    });
    await t.test("missing email creates one assigned HIGH task and escalation event, not a fake send", async () => {
      const [missing] = await tx.insert(brokers).values({ name: `NO EMAIL FIXTURE ${suffix}`, contactPerson: "Fixture", email: "", phone: "000-000-0000", dataOrigin: "pilot" }).returning();
      const invoice = await newInvoice("no-email", { brokerId: missing.id });
      const before = accepted.length;
      await service.runScheduled({ invoiceIds: [invoice.id] });
      await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(accepted.length, before);
      const followups = await tx.select().from(tasks).where(eq(tasks.confirmationInvoiceId, invoice.id));
      assert.equal(followups.length, 1); assert.equal(followups[0].assignedTo, userId);
      assert.equal(followups[0].priority, "high"); assert.equal(followups[0].confirmationKind, "missing_email");
      assert.equal((await stored(invoice.id)).confirmationSentAt, null);
    });
    await t.test("three reminders, first-send timestamp preserved, one escalation, no fourth reminder", async () => {
      const invoice = await newInvoice("cadence");
      await service.runScheduled({ invoiceIds: [invoice.id] });
      const first = clock.getTime();
      clock = new Date(first + DAY);
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      assert.equal((await stored(invoice.id)).confirmationSentAt?.getTime(), first);
      for (const [index, days] of [3, 7, 14].entries()) {
        clock = new Date(first + days * DAY);
        await service.runScheduled({ invoiceIds: [invoice.id] });
        assert.equal((await stored(invoice.id)).confirmationRemindedCount, index + 1);
      }
      const before = accepted.length;
      clock = new Date(first + 30 * DAY);
      await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(accepted.length, before);
      const followups = await tx.select().from(tasks).where(eq(tasks.confirmationInvoiceId, invoice.id));
      assert.equal(followups.length, 1); assert.equal(followups[0].priority, "high");
      assert.equal((await tx.select().from(brokerConfirmationEvents).where(and(eq(brokerConfirmationEvents.invoiceId, invoice.id), eq(brokerConfirmationEvents.event, "escalated")))).length, 1);
      clock = new Date(at);
    });
    await t.test("broker dispute creates one urgent task; explicit phone confirmation resolves it and logs the agent", async () => {
      const invoice = await newInvoice("dispute");
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      await service.brokerRespond(invoice.brokerConfirmationToken, "disputed", "Wrong load on paperwork");
      await service.brokerRespond(invoice.brokerConfirmationToken, "disputed", "Duplicate click");
      const [task] = await tx.select().from(tasks).where(eq(tasks.confirmationInvoiceId, invoice.id));
      assert.equal(task.priority, "urgent"); assert.equal(task.assignedTo, userId);
      assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "disputed");
      await service.resolve(invoice.id, "confirmed", { kind: "agent", id: userId }, "Phone: broker verified the corrected load.");
      assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "confirmed");
      assert.equal((await tx.select().from(tasks).where(eq(tasks.id, task.id)))[0].status, "completed");
      const [entry] = await tx.select().from(brokerConfirmationEvents).where(and(eq(brokerConfirmationEvents.invoiceId, invoice.id), eq(brokerConfirmationEvents.event, "confirmed")));
      assert.equal(entry.actor, `agent:${userId}`); assert.match(entry.notes!, /Phone/);
      assert.ok((await tx.select().from(eventLedger).where(and(eq(eventLedger.entityId, invoice.id), eq(eventLedger.eventType, "broker_confirmation_confirmed")))).length > 0);
    });
    await t.test("manager reassignment moves open tasks, rejects inactive staff and preserves original processor", async () => {
      const invoice = await newInvoice("reassign");
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      await service.brokerRespond(invoice.brokerConfirmationToken, "disputed", "");
      await assert.rejects(service.reassign(invoice.id, inactiveId, { kind: "agent", id: managerId }), /active staff/);
      await service.reassign(invoice.id, otherId, { kind: "agent", id: managerId });
      assert.equal((await stored(invoice.id)).assignedFollowupAgentId, otherId);
      assert.equal((await stored(invoice.id)).submittedBy, userId);
      const [task] = await tx.select().from(tasks).where(eq(tasks.confirmationInvoiceId, invoice.id));
      assert.equal(task.assignedTo, otherId);
    });
    await t.test("14-day unconfirmed preflight INFO and funded-date aging are unchanged by confirmation", async () => {
      const invoice = await newInvoice("aging", { fundedAt: new Date(Date.now() - 20 * DAY), confirmationSentAt: new Date(Date.now() - 15 * DAY), brokerConfirmationStatus: "sent" });
      const result = await runInvoicePreflight({ carrierId: carrier.id, brokerId: broker.id }, tx as unknown as typeof db);
      assert.ok(result.alerts.some(alert => alert.code === "BROKER_UNCONFIRMED" && alert.severity === "info"));
      const before = (await getConfirmationAgingRows(eq(invoices.id, invoice.id), tx))[0];
      await service.resolve(invoice.id, "confirmed", { kind: "agent", id: userId }, "Phone confirmation");
      const after = (await getConfirmationAgingRows(eq(invoices.id, invoice.id), tx))[0];
      assert.equal(before.ageDays, after.ageDays); assert.equal(before.outstanding, after.outstanding);
      assert.equal(after.confirmationStatus, "confirmed"); assert.equal(after.fundedAt?.getTime(), invoice.fundedAt?.getTime());
      const managerScope = await getConfirmationInvoiceScope({ id: managerId, role: "manager" }, tx);
      assert.ok((await getConfirmationAgingRows(managerScope, tx)).some(row => row.invoiceId === invoice.id));
      assert.equal((await getConfirmationAgingRows(await getConfirmationInvoiceScope({ id: otherId, role: "employee" }, tx), tx)).some(row => row.invoiceId === invoice.id), false);
    });
    await t.test("public GET is non-confirming; CSRF-protected POST works; agent scope and manager-only reassignment enforced", async () => {
      const invoice = await newInvoice("http");
      const docs = await paperwork(invoice.id);
      const otherInvoice = await newInvoice("http-other");
      const foreignDocs = await paperwork(otherInvoice.id);
      const signed: string[] = [];
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
      const auth: express.RequestHandler = (req: any, res, next) => {
        const id = req.headers["x-fixture-user"];
        if (!id) return void res.status(401).json({ message: "Authentication required" });
        req.user = { id, role: id === managerId ? "manager" : "employee" }; next();
      };
      const manager: express.RequestHandler = (req: any, res, next) => auth(req, res, () => req.user.role === "manager" ? next() : res.status(403).end());
      registerBrokerConfirmationRoutes(app, { store: tx, service, requireAuth: auth, requireManagerOrAdmin: manager,
        signedDownload: async (key, name, seconds) => {
          signed.push(key); assert.equal(seconds, 60); assert.ok(name?.endsWith(".pdf"));
          return "https://example.test/fixture-download";
        },
        canAccessInvoice: async (req, id) => { const row = await stored(id); return !!row && (req.user.role === "manager" || row.submittedBy === req.user.id || row.assignedFollowupAgentId === req.user.id); } });
      const server = app.listen(0);
      try {
        const address = server.address(); assert.ok(address && typeof address !== "string");
        const root = `http://127.0.0.1:${address.port}`;
        const url = `${root}/api/broker-confirm/${invoice.brokerConfirmationToken}`;
        const download = (token: string, id: number) => `${root}/api/broker-confirm/${token}/documents/${id}/download`;
        const file = await fetch(download(invoice.brokerConfirmationToken, docs[0].id), { redirect: "manual" });
        assert.equal(file.status, 302); assert.equal(file.headers.get("location"), "https://example.test/fixture-download");
        assert.equal(signed.length, 1); assert.equal(signed[0], docs[0].s3Key);
        assert.equal((await fetch(download(invoice.brokerConfirmationToken, foreignDocs[0].id))).status, 404);
        assert.equal((await fetch(download(invoice.brokerConfirmationToken, docs[4].id))).status, 404, "private carrier documents stay private");
        assert.equal((await fetch(download(randomUUID(), docs[0].id))).status, 404);
        assert.equal((await fetch(download(otherInvoice.brokerConfirmationToken, foreignDocs[0].id))).status, 404, "unsent tokens cannot download");
        assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "sent", "downloads never record a response");
        const first = await fetch(url);
        assert.equal(first.status, 200);
        const html = await first.text(); assert.match(html, /Opening this page has not confirmed receipt/);
        assert.match(html, /--surface:#e0e0e0/);
        assert.match(html, /class="invoice-details"/);
        assert.ok(html.includes(invoice.carrierInvoiceNumber!), "show actual carrier invoice reference, never row ID");
        assert.ok(!html.includes("#000080") && !html.includes("outset"), "no legacy Win95 header or bevel");
        assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "sent");
        const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)![1];
        const cookie = first.headers.get("set-cookie")!.split(";")[0];
        const noCookie = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf }) });
        assert.equal(noCookie.status, 403);
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: new URLSearchParams({ csrf }) });
        assert.equal(response.status, 200);
        const successHtml = await response.text();
        assert.match(successHtml, /Thank you/);
        assert.match(successHtml, /<svg/);
        assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "confirmed");
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`)).status, 401);
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`, { headers: { "x-fixture-user": otherId } })).status, 403);
        const detail = await (await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`, { headers: { "x-fixture-user": userId } })).json() as Record<string, unknown>;
        assert.equal(detail.status, "confirmed"); assert.equal("brokerConfirmationToken" in detail, false);
        assert.equal(detail.respondedAt, clock.toISOString());
        assert.match(String(detail.respondedBy), /CONFIRMATION FIXTURE.*confirmation-fixture@example.test/);
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-fixture-user": userId }, body: JSON.stringify({ agentId: otherId }) })).status, 403);
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation/mark-confirmed`, { method: "POST", headers: { "Content-Type": "application/json", "x-fixture-user": userId }, body: JSON.stringify({ notes: "" }) })).status, 400);
        assert.equal((await fetch(`${root}/api/broker-confirm/${randomUUID()}`)).status, 404);
        const disputed = await newInvoice("http-dispute");
        await service.sendForInvoice(disputed.id, { kind: "agent", id: userId });
        const disputeUrl = `${root}/api/broker-dispute/${disputed.brokerConfirmationToken}`;
        const disputePage = await fetch(disputeUrl);
        const disputeHtml = await disputePage.text();
        assert.match(disputeHtml, /name="reason"/);
        assert.equal((await stored(disputed.id)).brokerConfirmationStatus, "sent");
        const disputeCsrf = disputeHtml.match(/name="csrf" value="([a-f0-9]+)"/)![1];
        const disputeCookie = disputePage.headers.get("set-cookie")!.split(";")[0];
        const disputeResponse = await fetch(disputeUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: disputeCookie },
          body: new URLSearchParams({ csrf: disputeCsrf, reason: "Wrong invoice amount" }) });
        assert.equal(disputeResponse.status, 200);
        assert.match(await disputeResponse.text(), /Dispute recorded/i);
        const disputeDetail = await service.details(disputed.id);
        assert.equal(disputeDetail.status, "disputed"); assert.equal(disputeDetail.disputedAt?.getTime(), clock.getTime());
        assert.match(disputeDetail.respondedBy!, /confirmation-fixture@example.test/);
        assert.equal((await stored(disputed.id)).status, "funded", "receipt response never overwrites financial status");
        for (const [row, winning] of [[invoice, "confirm"], [disputed, "dispute"]] as const) {
          const losing = winning === "confirm" ? "dispute" : "confirm";
          const loserUrl = `${root}/api/broker-${losing}/${row.brokerConfirmationToken}`;
          assert.equal((await fetch(loserUrl)).status, 409, "opposite response page is blocked");
          // CSRF minted on a pending invoice, then both actions attempted:
          // covered separately below to ensure POST cannot override either.
          const terminal = await stored(row.id);
          assert.equal(terminal.brokerConfirmationStatus, winning === "confirm" ? "confirmed" : "disputed");
        }
        for (const winning of ["confirm", "dispute"] as const) {
          const row = await newInvoice(`first-wins-${winning}`);
          await service.sendForInvoice(row.id, { kind: "agent", id: userId });
          const forms = new Map<string, { url: string; csrf: string; cookie: string }>();
          for (const action of ["confirm", "dispute"]) {
            const actionUrl = `${root}/api/broker-${action}/${row.brokerConfirmationToken}`;
            const form = await fetch(actionUrl); const body = await form.text();
            forms.set(action, { url: actionUrl, csrf: body.match(/name="csrf" value="([a-f0-9]+)"/)![1],
              cookie: form.headers.get("set-cookie")!.split(";")[0] });
          }
          const submit = (action: string) => {
            const form = forms.get(action)!;
            return fetch(form.url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: form.cookie },
              body: new URLSearchParams({ csrf: form.csrf, reason: "Fixture response" }) });
          };
          assert.equal((await submit(winning)).status, 200);
          assert.equal((await submit(winning)).status, 200, "repeat same response is idempotent");
          const rejected = await submit(winning === "confirm" ? "dispute" : "confirm");
          assert.equal(rejected.status, 409); assert.match(await rejected.text(), /already been/);
          const log = (await service.details(row.id)).events.filter(event => ["confirmed", "disputed"].includes(event.event));
          assert.equal(log.length, 1); assert.equal(log[0].event, winning === "confirm" ? "confirmed" : "disputed");
          assert.equal(log[0].createdAt.getTime(), clock.getTime()); assert.match(log[0].actor, /confirmation-fixture@example.test/);
          const audit = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityId, row.id),
            eq(eventLedger.eventType, `broker_confirmation_${log[0].event}`)));
          assert.equal(audit.length, 1);
        }
        const [urgent] = await tx.select().from(tasks).where(eq(tasks.confirmationInvoiceId, disputed.id));
        assert.equal(urgent.priority, "urgent"); assert.match(urgent.description!, /Wrong invoice amount/);
        assert.equal((await fetch(`${root}/api/broker-confirmation-settings`, { method: "PATCH",
          headers: { "Content-Type": "application/json", "x-fixture-user": userId }, body: JSON.stringify(config) })).status, 403);
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
    throw new FixtureRollback("All fixtures roll back; no staff mail or notifications sent.");
  }), FixtureRollback);
});
after(async () => { await pool.end(); });

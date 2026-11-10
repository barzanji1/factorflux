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
  brokers, clients, users, invoices, tasks, brokerConfirmationEvents, eventLedger,
  insertInvoiceSchema, insertTaskSchema, brokerConfirmationSettings,
  documents,
} from "../../shared/schema";
import { createBrokerConfirmationService, confirmationAction, fundedAgeDays, getConfirmationAgingRows, getConfirmationInvoiceScope } from "./brokerConfirmationService";
import { registerBrokerConfirmationRoutes, confirmationSettingsSchema } from "../routes/brokerConfirmation";
import { runInvoicePreflight } from "./invoicePreflight";
import { brokerPaperwork, brokerPaperworkBody } from "./brokerPaperwork";

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

    await t.test("receipt emails include only this invoice's paperwork, with escaped download links", async () => {
      const invoice = await newInvoice("paperwork");
      const unrelated = await newInvoice("other-paperwork");
      await tx.insert(documents).values([
        ...(["rate_confirmation", "bol", "lumper_receipt", "other"] as const).map(type => ({
          invoiceId: invoice.id, filename: `${suffix}-${type}.pdf`,
          originalName: `${type} & paperwork.pdf`, mimeType: "application/pdf", size: 100,
          s3Key: `fixtures/${suffix}/${type}.pdf`, documentType: type, uploadedBy: userId,
        })),
        { invoiceId: unrelated.id, filename: "unrelated.pdf", originalName: "unrelated.pdf",
          mimeType: "application/pdf", size: 100, documentType: "bol", uploadedBy: userId },
        { invoiceId: invoice.id, filename: "identity.pdf", originalName: "private-identity.pdf",
          mimeType: "application/pdf", size: 100, documentType: "driver_id", uploadedBy: userId },
      ]);
      const files = await brokerPaperwork(tx, invoice);
      assert.equal(files.length, 4);
      assert.ok(files.every(file => !/unrelated|identity/.test(file.name)));
      const body = brokerPaperworkBody(invoice.brokerConfirmationToken, files);
      assert.match(body.html, /&amp; paperwork/);
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      const mail = accepted.at(-1)!;
      for (const file of files) assert.ok(mail.html?.includes(`/documents/${file.id}`));
      assert.doesNotMatch(mail.html!, /private-identity|unrelated\.pdf/);
    });

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
      const before = accepted.length;
      const result = await service.runScheduled({ invoiceIds: [invoice.id] });
      assert.equal(result.errors.length, 0);
      assert.equal(accepted.length, before + 1);
      const mail = accepted.at(-1)!;
      assert.match(mail.html!, /Confirm Receipt/); assert.match(mail.html!, /Dispute/);
      assert.match(mail.html!, /data-tpf-email="1"/);
      assert.match(mail.html!, /https:\/\/factorflux\.io\/api\/broker-confirm\//);
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
      await service.sendForInvoice(invoice.id, { kind: "agent", id: userId });
      const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
      const auth: express.RequestHandler = (req: any, res, next) => {
        const id = req.headers["x-fixture-user"];
        if (!id) return void res.status(401).json({ message: "Authentication required" });
        req.user = { id, role: id === managerId ? "manager" : "employee" }; next();
      };
      const manager: express.RequestHandler = (req: any, res, next) => auth(req, res, () => req.user.role === "manager" ? next() : res.status(403).end());
      registerBrokerConfirmationRoutes(app, { store: tx, service, requireAuth: auth, requireManagerOrAdmin: manager,
        canAccessInvoice: async (req, id) => { const row = await stored(id); return !!row && (req.user.role === "manager" || row.submittedBy === req.user.id || row.assignedFollowupAgentId === req.user.id); } });
      const server = app.listen(0);
      try {
        const address = server.address(); assert.ok(address && typeof address !== "string");
        const root = `http://127.0.0.1:${address.port}`;
        {
        // Follow the actual email Dispute href, and prove neither GET nor a
        // Confirm form's CSRF token can submit the other action.
        const disputed = await newInvoice("http-dispute-from-email");
        await service.sendForInvoice(disputed.id, { kind: "agent", id: userId });
        const emailHtml = accepted.at(-1)!.html!;
        const disputeHref = emailHtml.match(/href="(https:\/\/factorflux\.io\/api\/broker-dispute\/[^"]+)"/)![1];
        const disputeUrl = root + new URL(disputeHref).pathname;
        const disputePage = await fetch(disputeUrl);
        const disputeHtml = await disputePage.text();
        assert.match(disputeHtml, /Submit Dispute/);
        assert.match(disputeHtml, new RegExp(`action="/api/broker-dispute/${disputed.brokerConfirmationToken}"`));
        assert.equal((await stored(disputed.id)).brokerConfirmationStatus, "sent");
        const disputeCsrf = disputeHtml.match(/name="csrf" value="([a-f0-9]+)"/)![1];
        const disputeCookie = disputePage.headers.get("set-cookie")!.split(";")[0];
        const crossAction = await fetch(`${root}/api/broker-confirm/${disputed.brokerConfirmationToken}`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: disputeCookie },
          body: new URLSearchParams({ csrf: disputeCsrf }),
        });
        assert.equal(crossAction.status, 403);
        const disputeResponse = await fetch(disputeUrl, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: disputeCookie },
          body: new URLSearchParams({ csrf: disputeCsrf, reason: "Fixture: incorrect paperwork" }),
        });
        assert.equal(disputeResponse.status, 200);
        assert.match(await disputeResponse.text(), /Dispute recorded/);
        assert.equal((await stored(disputed.id)).brokerConfirmationStatus, "disputed");
        assert.equal((await stored(disputed.id)).brokerConfirmedAt, null);
        assert.equal((await fetch(`${root}/api/broker-confirm/${invoice.brokerConfirmationToken}/documents/2147483647`)).status, 404);
        const [paper] = await tx.insert(documents).values({
          invoiceId: invoice.id, filename: `${suffix}-download.pdf`, originalName: "Rate Confirmation.pdf",
          mimeType: "application/pdf", size: 100, documentType: "rate_confirmation",
          s3Key: `fixtures/${suffix}/rate.pdf`, uploadedBy: userId,
        }).returning();
        const downloadPath = `/documents/${paper.id}`;
        const download = await fetch(`${root}/api/broker-confirm/${invoice.brokerConfirmationToken}${downloadPath}`, { redirect: "manual" });
        assert.equal(download.status, 302, "valid invoice-token link issues a short-lived download without staff login");
        assert.match(download.headers.get("location")!, /X-Amz-Expires=300/);
        assert.equal(download.headers.get("referrer-policy"), "no-referrer");
        assert.equal((await fetch(`${root}/api/broker-confirm/${disputed.brokerConfirmationToken}${downloadPath}`, { redirect: "manual" })).status, 404,
          "a different active invoice's token cannot download this paperwork");
        assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "sent", "downloads do not confirm receipt");
        }
        const url = `${root}/api/broker-confirm/${invoice.brokerConfirmationToken}`;
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
        const opposite = await fetch(`${root}/api/broker-dispute/${invoice.brokerConfirmationToken}`);
        assert.equal(opposite.status, 409);
        assert.match(await opposite.text(), /has not changed that response/);
        assert.equal((await stored(invoice.id)).brokerConfirmationStatus, "confirmed");
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`)).status, 401);
        assert.equal((await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`, { headers: { "x-fixture-user": otherId } })).status, 403);
        const detail = await (await fetch(`${root}/api/invoices/${invoice.id}/broker-confirmation`, { headers: { "x-fixture-user": userId } })).json() as Record<string, unknown>;
        assert.equal(detail.status, "confirmed"); assert.equal("brokerConfirmationToken" in detail, false);
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

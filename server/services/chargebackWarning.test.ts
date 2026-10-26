import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import {
  brokerConfirmationSettings, brokers, cashApplications, clients, emailLog, eventLedger,
  invoiceChargebackWarnings, invoices, paymentApplicationLines, tasks, users,
} from "../../shared/schema";
import { createResendTransport, SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO } from "../resendTransport.js";
import { createEmailLogRecorder } from "./emailLogService";
import { confirmationSettingsSchema } from "../routes/brokerConfirmation";
import { processChargebackWarnings, recordChargebackWarningSent, warningEligible, warningMessage } from "./chargebackWarning";
import { formatInvoiceTimelineEvent } from "./invoiceStage";

after(() => pool.end());
const DAY = 86_400_000;
const at = new Date("2026-10-26T16:00:00Z");

test("warning uses funded_at + threshold, positive outstanding AR, and skips terminal invoices", () => {
  const invoice = { fundedAt: new Date(at.getTime() - 80 * DAY), status: "funded", chargebackStatus: "none" };
  assert.equal(warningEligible(invoice, "750.00", 80, at), true);
  assert.equal(warningEligible(invoice, "750.00", 80, new Date(at.getTime() - 1)), false);
  assert.equal(warningEligible(invoice, "750.00", 81, at), false);
  assert.equal(warningEligible(invoice, "750.00", 79, at), true);
  for (const status of ["paid", "settled", "collected", "rejected"]) assert.equal(warningEligible({ ...invoice, status }, "750", 80, at), false);
  assert.equal(warningEligible({ ...invoice, chargebackStatus: "charged" }, "750", 80, at), false);
  assert.equal(warningEligible({ ...invoice, fundedAt: null }, "750", 80, at), false);
  assert.equal(warningEligible(invoice, 0, 80, at), false);
  assert.equal(warningEligible(invoice, -1, 80, at), false);
  assert.equal(warningEligible({ ...invoice, chargebackStatus: "scheduled" }, "750", 80, at), true);
});

test("warning wording and configurable threshold validation", () => {
  assert.equal(warningMessage("INV-9001", "150611", 80, "750"),
    "This is a reminder that Invoice INV-9001 for Load 150611 is now 80 days past due. Per our agreement, invoices unpaid after 90 days are subject to chargeback. Amount due: $750.00. Please remit payment immediately.");
  const settings = { maxReminders: 3, reminderDays: [3, 7, 14], publicBaseUrl: "https://factorflux.io" };
  for (const value of [1, 79, 80, 89]) assert.equal(confirmationSettingsSchema.safeParse({ ...settings, chargebackWarningDays: value }).success, true);
  for (const value of [0, 90, 1.5, "80", null]) assert.equal(confirmationSettingsSchema.safeParse({ ...settings, chargebackWarningDays: value }).success, false);
  // An older settings client cannot reset a customized warning threshold.
  assert.equal(confirmationSettingsSchema.parse(settings).chargebackWarningDays, undefined);
});

test("Preview blocks real transport without creating warning claims", async () => {
  if (process.env.NODE_ENV !== "production") assert.equal((await processChargebackWarnings()).blockedInPreview, true);
});

test("invoice timeline renders warning success and failure details", () => {
  const sent = formatInvoiceTimelineEvent("chargeback_warning_sent", { thresholdDays: 80, agedDays: 80, amountDue: "750.00" });
  assert.equal(sent.title, "80-day chargeback warning sent");
  assert.match(sent.description, /\$750\.00 outstanding after 80 days/);
  assert.match(sent.description, /follow-up task created/);
  const failed = formatInvoiceTimelineEvent("chargeback_warning_failed", { error: "Broker has no valid email address." });
  assert.equal(failed.title, "Chargeback warning delivery failed");
  assert.equal(failed.description, "Broker has no valid email address.");
});

test("scheduler logs branded delivery, creates one assigned follow-up, skips paid/charged invoices, and reconciles without duplicates (rollback)", async () => {
  const rollback = new Error("ROLLBACK_CHARGEBACK_WARNING_FIXTURES");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const agentId = `warning-agent-${tag}`;
    await tx.insert(users).values({ id: agentId, firstName: "Warning", lastName: "Fixture", role: "employee", status: "active" });
    const [client] = await tx.insert(clients).values({ name: `Warning carrier ${tag}`, status: "new_client", assignedProcessor: agentId }).returning();
    const [broker] = await tx.insert(brokers).values({ name: `Warning broker ${tag}`, email: "delivered@resend.dev",
      contactPerson: "Warning fixture", phone: "000-000-0000", dataOrigin: "pilot" }).returning();
    await tx.update(brokerConfirmationSettings).set({ chargebackWarningDays: 80 }).where(eq(brokerConfirmationSettings.id, 1));
    const make = async (label: string, values: Partial<typeof invoices.$inferInsert> = {}) => {
      const [invoice] = await tx.insert(invoices).values({
        invoiceNumber: `WARN-${label}-${tag}`, loadNumber: `LOAD-${label}-${tag}`, loadId: null, clientId: client.id,
        brokerId: broker.id, status: "funded", fundedAt: new Date(at.getTime() - 80 * DAY),
        amount: "1000", assignedTo: agentId, submittedBy: agentId, ...values,
      }).returning();
      return invoice;
    };
    const due = await make("due");
    const early = await make("early", { fundedAt: new Date(at.getTime() - 79 * DAY) });
    const paid = await make("paid", { status: "paid" });
    const charged = await make("charged", { chargebackStatus: "charged" });
    const fullyPaid = await make("fully-paid");
    const writtenOff = await make("written-off");
    const missing = await make("missing-email", { brokerId: null });
    const failed = await make("provider-failure");
    const ids = [due, early, paid, charged, fullyPaid, writtenOff, missing, failed].map(row => row.id);
    const [cash] = await tx.insert(cashApplications).values({
      paymentReference: `WARN-CASH-${tag}`, payorName: "Warning fixture", paymentDate: at, totalReceived: "2150",
    }).returning();
    for (const [invoice, amount, variance] of [[due, "250", "0"], [fullyPaid, "1000", "0"], [writtenOff, "900", "100"]] as const) {
      await tx.insert(paymentApplicationLines).values({ cashApplicationId: cash.id, invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber, invoiceAmount: "1000", appliedAmount: amount,
        varianceType: variance === "100" ? "write_off" : "full_match", variance });
    }
    const captured: any[] = [];
    const send = createResendTransport(async (_connector, _path, request) => {
      captured.push(request.body);
      if (String((request.body as any).subject).includes("provider-failure")) {
        return new Response(JSON.stringify({ message: "Fixture rejected" }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: `warning-message-${captured.length}` }), { status: 200 });
    }, 1000, createEmailLogRecorder({ store: tx, upload: async () => "mock-email-logo", now: () => at }));
    const run = () => processChargebackWarnings({ store: tx, send, now: () => at, invoiceIds: ids });
    const result = await run();
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 2);
    assert.equal(captured.length, 2);
    const delivered = captured.find(body => body.subject.includes("WARN-due-"));
    assert.equal(delivered.from, SYSTEM_EMAIL_FROM);
    assert.equal(delivered.reply_to, SYSTEM_EMAIL_REPLY_TO);
    assert.deepEqual(delivered.to, ["delivered@resend.dev"]);
    assert.match(delivered.html, /data-tpf-email="1"/);
    assert.match(delivered.html, /Trucking Pros Financial/);
    assert.doesNotMatch(delivered.html, /FactorFlux/);
    assert.match(delivered.text, /Amount due: \$750\.00/);
    const warnings = await tx.select().from(invoiceChargebackWarnings).where(inArray(invoiceChargebackWarnings.invoiceId, ids));
    assert.equal(warnings.length, 3);
    assert.equal(warnings.find(row => row.invoiceId === due.id)?.status, "sent");
    const createdTasks = await tx.select().from(tasks).where(eq(tasks.clientId, client.id));
    assert.equal(createdTasks.length, 3);
    assert(createdTasks.every(task => task.assignedTo === agentId && task.type === "followup"));
    const logs = await tx.select().from(emailLog).where(and(eq(emailLog.templateName, "chargeback_warning"), inArray(emailLog.entityId, ids.map(String))));
    assert.equal(logs.length, 2);
    assert.equal(logs.find(log => log.entityId === String(due.id))?.status, "sent");
    assert.equal(logs.find(log => log.entityId === String(failed.id))?.status, "failed");
    const sentEvents = () => tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"),
      eq(eventLedger.entityId, due.id), eq(eventLedger.eventType, "chargeback_warning_sent")));
    assert.equal((await sentEvents()).length, 1);
    assert.equal((await run()).sent, 0);
    assert.equal(captured.length, 2);
    // Simulate acceptance recorded by the wrapper but not the workflow, then
    // prove a scheduler restart recovers the timeline without another email.
    await tx.delete(eventLedger).where(and(eq(eventLedger.entityId, due.id), eq(eventLedger.eventType, "chargeback_warning_sent")));
    await tx.update(invoiceChargebackWarnings).set({ status: "uncertain", messageId: null, sentAt: null })
      .where(eq(invoiceChargebackWarnings.invoiceId, due.id));
    await run();
    await recordChargebackWarningSent(due.id, "warning-message-1", tx, at);
    assert.equal((await sentEvents()).length, 1);
    assert.equal(captured.length, 2);
    await tx.update(brokerConfirmationSettings).set({ chargebackWarningDays: 79 }).where(eq(brokerConfirmationSettings.id, 1));
    assert.equal((await run()).sent, 1);
    assert.match(captured.at(-1).text, /is now 79 days past due/);
    assert.equal((await tx.select().from(tasks).where(eq(tasks.clientId, client.id))).length, 4);
    throw rollback;
  }), error => error === rollback);
});

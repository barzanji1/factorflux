import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, users, invoices, eventLedger } from "../../shared/schema";
import { chargebackLifecycle, recordChargebackRefund, recordShortPayResolution } from "./chargebackResolutions";
import { buildChargebackReport, chargebackReportCsv } from "./chargebackReport";

after(() => pool.end());
test("refunds fail closed, restore only verified debits, are cumulative/idempotent, and recoveries reconcile cash (rollback)", async () => {
  const rollback = new Error("ROLLBACK_RESOLUTIONS");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID(), actor = `refund-qa-${tag}`;
    await tx.insert(users).values({ id: actor, firstName: "Refund", lastName: "QA", role: "admin", status: "active", isTestAccount: false });
    const [carrier] = await tx.insert(clients).values({ name: `Refund QA ${tag}`, status: "new_client", reserves: "500", email: "refund-fixture@example.test" }).returning();
    const make = async (suffix: string) => (await tx.insert(invoices).values({
      invoiceNumber: `${suffix}-${tag}`, loadId: null, clientId: carrier.id, amount: "500",
      status: "funded", fundedAt: new Date("2026-07-01"), chargebackStatus: "charged", chargebackDate: new Date("2026-10-01"),
    }).returning())[0];
    const invoice = await make("REFUND"), noDebit = await make("NO-DEBIT");
    let sent = 0;
    const sender = async () => { sent++; return "mock-resend-id"; };
    const request = { amount: "200", refundDate: "2026-10-20", reference: "ACH-QA", reason: "Broker settled",
      approvedBy: actor, idempotencyKey: randomUUID(), method: "recorded" };
    await assert.rejects(recordChargebackRefund(noDebit.id, request, actor, tx, sender), /verified.*debit/i);
    await tx.insert(eventLedger).values({ entityType: "invoice", entityId: invoice.id, eventType: "chargeback_reserve_debited",
      actorType: "user", actorId: actor, payloadJson: { amount: "500.00", verified: true, reference: "Original reserve debit proof" } });
    const first = await recordChargebackRefund(invoice.id, request, actor, tx, sender);
    assert.equal(first.emailStatus, "sent");
    assert.equal(sent, 1);
    let state = await chargebackLifecycle(invoice.id, tx);
    assert.equal(state.refundedAmount, 200);
    assert.equal(state.refundableAmount, 300);
    assert.equal(state.resolutionStatus, "open");
    assert.equal(state.events.filter(e => e.eventType === "chargeback_refunded").length, 1);
    assert.equal((await tx.execute(sql`SELECT reserves FROM clients WHERE id=${carrier.id}`)).rows[0].reserves, "700.00");
    await recordChargebackRefund(invoice.id, request, actor, tx, sender);
    assert.equal(sent, 1, "same key cannot restore reserves or email twice");
    await assert.rejects(recordChargebackRefund(invoice.id, { ...request, amount: "201" }, actor, tx, sender), /different details/);
    await assert.rejects(recordChargebackRefund(invoice.id, { ...request, amount: "301", idempotencyKey: randomUUID() }, actor, tx, sender), /exceeds/);
    const second = await recordChargebackRefund(invoice.id, { ...request, amount: "300", idempotencyKey: randomUUID(), reference: "ACH-FINAL" },
      actor, tx, async () => { throw new Error("Mock mail rejection"); });
    assert.equal(second.emailStatus, "failed");
    assert.match(second.emailError!, /Mock mail rejection/);
    state = await chargebackLifecycle(invoice.id, tx);
    assert.equal(state.refundedAmount, 500);
    assert.equal(state.resolutionStatus, "refunded");
    assert.equal((await tx.execute(sql`SELECT reserves FROM clients WHERE id=${carrier.id}`)).rows[0].reserves, "1000.00");
    await assert.rejects(recordChargebackRefund(invoice.id, { ...request, amount: "1", idempotencyKey: randomUUID() }, actor, tx, sender), /No refundable/);
    const report = await buildChargebackReport({ carrierId: carrier.id, section: "chargebacks", status: "refunded" }, tx);
    assert.equal(report.chargebacks.length, 1);
    assert.equal(report.chargebacks[0].netChargeback, 0);
    assert.equal(report.chargebacks[0].paymentReference, "ACH-QA, ACH-FINAL");
    assert.equal(report.totals.chargebacks.refunded, 500);
    const csv = chargebackReportCsv(report, ["invoiceNumber", "refundedAmount"]);
    assert.match(csv, /Refund amount/);
    assert.doesNotMatch(csv, /Carrier|Broker|Outstanding/);
    await assert.rejects(recordShortPayResolution(noDebit.id, {
      amount: "501", date: "2026-10-21", reference: "TOO-MUCH", status: "resolved", idempotencyKey: randomUUID(),
    }, actor, tx), /exceeds/);
    const recovery = { amount: "200", date: "2026-10-21", reference: "RECOVERY-1", status: "resolved", idempotencyKey: randomUUID() };
    await recordShortPayResolution(noDebit.id, recovery, actor, tx);
    await recordShortPayResolution(noDebit.id, recovery, actor, tx);
    let short = await buildChargebackReport({ carrierId: carrier.id, section: "shortPays" }, tx);
    let row = short.shortPays.find(r => r.invoiceId === noDebit.id)!;
    assert.equal(row.originalShortPay, 500);
    assert.equal(row.recoveredAmount, 200);
    assert.equal(row.cashApplied, 200);
    assert.equal(row.outstanding, 300);
    await recordShortPayResolution(noDebit.id, { ...recovery, amount: "300", reference: "RECOVERY-2", idempotencyKey: randomUUID() }, actor, tx);
    short = await buildChargebackReport({ carrierId: carrier.id, section: "shortPays", status: "resolved" }, tx);
    row = short.shortPays.find(r => r.invoiceId === noDebit.id)!;
    assert.equal(row.originalShortPay, 500);
    assert.equal(row.recoveredAmount, 500);
    assert.equal(row.cashApplied, 500);
    assert.equal(row.outstanding, 0);
    const writeOff = await make("WRITE-OFF");
    await recordShortPayResolution(writeOff.id, { ...recovery, amount: "500", status: "written_off", idempotencyKey: randomUUID() }, actor, tx);
    const written = await buildChargebackReport({ carrierId: carrier.id, section: "shortPays", status: "written_off" }, tx);
    assert.equal(written.shortPays[0].cashApplied, 0);
    assert.equal(written.shortPays[0].writtenOffAmount, 500);
    assert.equal(written.shortPays[0].outstanding, 0);
    throw rollback;
  }), error => error === rollback);
});

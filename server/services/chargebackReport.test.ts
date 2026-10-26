import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool } from "../db";
import {
  brokers, clients, invoices, cashApplications, paymentApplicationLines, eventLedger, exceptions, payouts,
} from "../../shared/schema";
import { chargebackReportFiltersSchema } from "../../shared/chargeback-report";
import { buildChargebackReport, chargebackReportCsv, searchChargebackReportDirectory } from "./chargebackReport";
import { registerChargebackReportRoutes } from "../routes/chargebackReport";

after(() => pool.end());
test("report validates dates, IDs, status and amount bounds", () => {
  for (const value of [
    { startDate: "2026-02-30" }, { startDate: "2026-11-01", endDate: "2026-10-01" },
    { carrierId: "0" }, { brokerId: "1 OR 1=1" }, { minAmount: "-1" },
    { minAmount: "100", maxAmount: "99" }, { status: "charged" },
  ]) assert.equal(chargebackReportFiltersSchema.safeParse(value).success, false);
  assert.equal(chargebackReportFiltersSchema.parse({ minAmount: "0", maxAmount: "", startDate: "" }).minAmount, 0);
});

test("chargebacks, all-cash short pays, actual deductions, filters, totals, CSV and permissions (rollback)", async () => {
  const rollback = new Error("ROLLBACK_CHARGEBACK_REPORT");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const at = new Date("2026-10-20T16:00:00Z");
    const [carrier] = await tx.insert(clients).values({ name: `=Report carrier ${tag}`, status: "new_client" }).returning();
    const [broker, otherBroker] = await tx.insert(brokers).values(["A", "B"].map(label => ({
      name: `Report broker ${label} ${tag}`, contactPerson: "Report fixture", phone: "000-000-0000",
      email: "report-fixture@example.test", dataOrigin: "pilot",
    }))).returning();
    const make = async (label: string, values: Partial<typeof invoices.$inferInsert> = {}) => {
      const [invoice] = await tx.insert(invoices).values({
        invoiceNumber: `REPORT-${label}-${tag}`, loadId: null, clientId: carrier.id, brokerId: broker.id,
        amount: "1000", status: "funded", fundedAt: new Date("2026-07-01T16:00:00Z"), ...values,
      }).returning();
      return invoice;
    };
    const open = await make("open", { chargebackStatus: "charged", chargebackDate: at });
    const collected = await make("collected", { amount: "500", chargebackStatus: "charged", chargebackDate: at });
    const writtenOff = await make("write-off", { amount: "300", chargebackStatus: "charged", chargebackDate: at });
    const unknown = await make("unknown", { amount: "400", chargebackStatus: "charged", chargebackDate: null });
    const partial = await make("partial");
    const unpaid = await make("unpaid");
    const paid = await make("paid", { amount: "100" });
    const waived = await make("waived", { amount: "200" });
    const closed = await make("closed-status", { status: "paid" });
    const other = await make("other-broker", { brokerId: otherBroker.id, amount: "50" });
    const pay = async (invoice: typeof open, amount: string, date: string, writeoff = "0") => {
      const [cash] = await tx.insert(cashApplications).values({
        paymentReference: randomUUID(), payorName: "Report fixture", paymentDate: new Date(date), totalReceived: amount,
      }).returning();
      await tx.insert(paymentApplicationLines).values({
        cashApplicationId: cash.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
        invoiceAmount: invoice.amount, appliedAmount: amount, variance: writeoff,
        varianceType: writeoff === "0" ? "short_pay" : "write_off",
      });
    };
    await pay(open, "200", "2026-10-19T16:00:00Z");
    await pay(open, "300", "2026-10-22T16:00:00Z");
    await pay(collected, "500", "2026-10-22T16:00:00Z");
    await pay(writtenOff, "200", "2026-10-22T16:00:00Z", "100");
    await pay(partial, "250", "2026-10-22T16:00:00Z");
    await pay(partial, "125", "2026-10-23T16:00:00Z");
    await pay(paid, "100", "2026-10-22T16:00:00Z");
    await pay(waived, "25", "2026-10-22T16:00:00Z");
    await tx.insert(exceptions).values({ type: "short_pay", entityType: "invoice", entityId: waived.id,
      title: "Waived fixture", status: "waived" });
    await tx.insert(eventLedger).values([
      { entityType: "invoice", entityId: open.id, eventType: "chargeback_applied", actorType: "system", createdAt: at, payloadJson: { days: 90 } },
      { entityType: "invoice", entityId: collected.id, eventType: "chargeback_applied", actorType: "system", createdAt: at,
        payloadJson: { chargebackAmount: "350.00", reason: "Recorded chargeback fixture" } },
      { entityType: "invoice", entityId: partial.id, eventType: "offset_applied", actorType: "system",
        createdAt: new Date("2026-10-27T01:30:00Z"), payloadJson: { amount: "35.00", reason: "Recorded offset" } },
      { entityType: "invoice", entityId: partial.id, eventType: "reserve_adjustment", actorType: "system",
        createdAt: new Date("2026-10-25T16:00:00Z"), payloadJson: { amount: "-10.00", reason: "Reserve credit" } },
      { entityType: "invoice", entityId: partial.id, eventType: "deduction_applied", actorType: "system",
        payloadJson: { amount: "not a number", reason: "Malformed legacy record must not crash report" } },
    ]);
    const payout = {
      clientId: carrier.id, invoiceAmount: "1000", advanceRate: "90", feeRate: "3",
      advanceAmount: "900", feeAmount: "30", reserveAmount: "100", netPayout: "870",
    };
    await tx.insert(payouts).values([
      { ...payout, invoiceId: partial.id, paymentStatus: "reserve_released",
        advancePaidAt: new Date("2026-10-19T16:00:00Z"), reserveReleasedAt: new Date("2026-10-24T16:00:00Z") },
      { ...payout, invoiceId: unpaid.id, paymentStatus: "pending_advance" },
    ]);
    const filters = { carrierId: carrier.id, brokerId: broker.id };
    const report = await buildChargebackReport(filters, tx);
    assert.equal(report.chargebacks.length, 4);
    const openRow = report.chargebacks.find(row => row.invoiceId === open.id)!;
    assert.equal(openRow.amount, 800);
    assert.equal(openRow.cashApplied, 500);
    assert.equal(openRow.outstanding, 500);
    assert.equal(openRow.status, "open");
    assert.match(openRow.amountSource, /Reconstructed/);
    assert.equal(report.chargebacks.find(row => row.invoiceId === collected.id)?.amount, 350);
    assert.equal(report.chargebacks.find(row => row.invoiceId === collected.id)?.status, "collected");
    assert.equal(report.chargebacks.find(row => row.invoiceId === writtenOff.id)?.status, "written_off");
    assert.equal(report.chargebacks.find(row => row.invoiceId === unknown.id)?.amount, null);
    assert.equal(report.totals.chargebacks.amount, 1450);
    assert.equal(report.totals.chargebacks.unknownAmounts, 1);
    assert.equal(report.totals.chargebacks.outstanding, 900);
    assert.equal(report.shortPays.find(row => row.invoiceId === partial.id)?.amount, 625);
    assert.equal(report.shortPays.find(row => row.invoiceId === unpaid.id)?.amount, 1000);
    for (const excluded of [collected, writtenOff, paid, waived, closed, other])
      assert.equal(report.shortPays.some(row => row.invoiceId === excluded.id), false);
    assert.equal(report.deductions.length, 5);
    assert.equal(report.totals.deductions.amount, 55);
    assert(report.deductions.every(row => row.invoiceId === partial.id));
    assert.equal((await buildChargebackReport({ ...filters, status: "collected" }, tx)).chargebacks.length, 1);
    assert.equal((await buildChargebackReport({ ...filters, status: "written_off" }, tx)).chargebacks.length, 1);
    const byAmount = await buildChargebackReport({ ...filters, status: "applied", minAmount: "90", maxAmount: "100" }, tx);
    assert.equal(byAmount.deductions.length, 2);
    assert.equal(byAmount.totals.deductions.amount, 0);
    assert.equal(byAmount.chargebacks.length, 0);
    assert.equal((await buildChargebackReport({ ...filters, minAmount: 0 }, tx)).totals.chargebacks.unknownAmounts, 0);
    const denver = await buildChargebackReport({ ...filters, startDate: "2026-10-26", endDate: "2026-10-26" }, tx);
    assert.equal(denver.deductions.length, 1);
    assert.equal(denver.deductions[0].amount, 35);
    assert.equal(denver.chargebacks.length, 0);
    const otherReport = await buildChargebackReport({ carrierId: carrier.id, brokerId: otherBroker.id }, tx);
    assert.deepEqual(otherReport.shortPays.map(row => row.invoiceId), [other.id]);
    const csv = chargebackReportCsv(report);
    assert.match(csv, /Trucking Pros Financial/);
    assert.match(csv, /"'=Report carrier/);
    assert.match(csv, /"-100\.00"/);
    assert.doesNotMatch(csv, /"'-100\.00"/);
    assert.equal((csv.match(/"TOTAL"/g) ?? []).length, 3);
    assert.match(csv, /unknown amounts excluded/);
    const search = await searchChargebackReportDirectory({ kind: "broker", q: tag }, tx);
    assert.equal(search.data.length, 2);
    assert.deepEqual(Object.keys(search.data[0]).sort(), ["id", "name"]);
    const app = express();
    registerChargebackReportRoutes(app, (req, res, next) => {
      if (!req.headers["x-user"]) { res.status(401).json({ message: "Login required" }); return; }
      if (req.headers["x-reports"] !== "yes") { res.status(403).json({ message: "Reports permission required" }); return; }
      next();
    }, input => buildChargebackReport(input, tx), input => searchChargebackReportDirectory(input, tx));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const query = new URLSearchParams({ carrierId: String(carrier.id), brokerId: String(broker.id) });
      const headers = { "x-user": "report-test", "x-reports": "yes" };
      for (const suffix of ["", ".csv", "/options?kind=broker"]) {
        assert.equal((await fetch(`${root}/api/reports/chargeback${suffix}`)).status, 401);
        assert.equal((await fetch(`${root}/api/reports/chargeback${suffix}`, { headers: { "x-user": "report-test" } })).status, 403);
      }
      const json = await fetch(`${root}/api/reports/chargeback?${query}`, { headers });
      assert.equal(json.status, 200);
      assert.deepEqual(await json.json(), report);
      const exported = await fetch(`${root}/api/reports/chargeback.csv?${query}`, { headers });
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-type")!, /text\/csv/);
      assert.equal((await exported.text()).replace(/^\uFEFF/, ""), csv.replace(/^\uFEFF/, ""));
      const invalid = await fetch(`${root}/api/reports/chargeback?minAmount=50&maxAmount=10`, { headers });
      assert.equal(invalid.status, 400);
      assert.match(invalid.headers.get("content-type")!, /application\/json/);
      const directory = await fetch(`${root}/api/reports/chargeback/options?kind=broker&q=${tag}`, { headers });
      assert.deepEqual(await directory.json(), search);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    throw rollback;
  }), error => error === rollback);
});

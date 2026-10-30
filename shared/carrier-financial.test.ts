import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCarrierFinancialSummary, type CarrierFinancialInvoice } from "./carrier-financial";

const at = new Date("2026-10-30T18:00:00Z");
const invoice = (values: Partial<CarrierFinancialInvoice> = {}): CarrierFinancialInvoice => ({
  id: 1, amount: "100.00", status: "funded", invoiceDate: "2026-10-01T18:00:00Z",
  createdAt: "2026-10-01T18:00:00Z", fundedAt: "2026-10-01T18:00:00Z", loadType: "otr_load",
  chargebackStatus: "none", ...values,
});
test("empty carrier renders missing DSO, not invented zero payments", () => {
  const summary = buildCarrierFinancialSummary([], [], [], at);
  assert.equal(summary.averageDaysToPay, null);
  assert.equal(summary.openAr, 0);
  assert.equal(summary.months.length, 6);
  assert.equal(summary.months[0].month, "2026-05");
  assert.equal(summary.months[5].month, "2026-10");
  assert.ok(summary.months.every(row => row.averageDaysToPay === null && row.invoices === 0));
});
test("funded totals and load-type breakdown reconcile, legacy types map to Other", () => {
  const summary = buildCarrierFinancialSummary([
    invoice(), invoice({ id: 2, amount: "50.25", loadType: "legacy", chargebackStatus: "charged" }),
    invoice({ id: 3, fundedAt: null, status: "draft" }),
    invoice({ id: 4, amount: "999.00", fundedAt: "2026-11-01T18:00:00Z" }),
  ], [], [], at);
  assert.equal(summary.totalFunded, 150.25);
  assert.equal(summary.revenue.reduce((sum, row) => sum + row.amount, 0), summary.totalFunded);
  assert.equal(summary.revenue.find(row => row.type === "other")?.amount, 50.25);
  assert.equal(summary.chargebackRate, 50);
});
test("DSO stops at first fully cash-paid event, partials and later payments do not distort it", () => {
  const summary = buildCarrierFinancialSummary([invoice(), invoice({ id: 2 })], [
    { invoiceId: 1, amount: 50, paymentDate: "2026-10-05T18:00:00Z" },
    { invoiceId: 1, amount: 50, paymentDate: "2026-10-11T18:00:00Z" },
    { invoiceId: 1, amount: 10, paymentDate: "2026-10-20T18:00:00Z" },
    { invoiceId: 2, amount: 50, paymentDate: "2026-10-11T18:00:00Z" },
  ], [], at);
  assert.equal(summary.averageDaysToPay, 10);
  assert.equal(summary.months[5].averageDaysToPay, 10);
  assert.equal(summary.months[5].paidInvoices, 1);
});
test("aging uses the existing five report bucket boundaries and sums to Open AR", () => {
  const summary = buildCarrierFinancialSummary([], [], [0, 1, 30, 31, 60, 61, 90, 91].map(ageDays => ({ ageDays, outstanding: 10 })), at);
  assert.deepEqual(summary.aging.map(row => row.amount), [10, 20, 20, 20, 10]);
  assert.equal(summary.aging.reduce((sum, row) => sum + row.amount, 0), summary.openAr);
  assert.equal(summary.openAr, 80);
});
test("cash calendar aging uses Denver days across midnight and DST", () => {
  const summary = buildCarrierFinancialSummary([invoice({ fundedAt: "2026-10-01T23:00:00Z" })], [
    { invoiceId: 1, amount: 100, paymentDate: "2026-10-03T01:00:00Z" },
  ], [], at);
  assert.equal(summary.averageDaysToPay, 1);
});
test("future payments are not counted and invoice months exclude drafts and rejections", () => {
  const summary = buildCarrierFinancialSummary([
    invoice(), invoice({ id: 2, status: "draft", fundedAt: null }), invoice({ id: 3, status: "rejected", fundedAt: null }),
  ], [{ invoiceId: 1, amount: 100, paymentDate: "2026-11-01T18:00:00Z" }], [], at);
  assert.equal(summary.averageDaysToPay, null);
  assert.equal(summary.months[5].invoices, 1);
});

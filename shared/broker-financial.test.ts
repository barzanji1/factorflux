import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrokerFinancialSummary } from "./broker-financial";
import type { CarrierFinancialInvoice } from "./carrier-financial";

const now = new Date("2026-10-30T18:00:00Z");
const invoice = (patch: Partial<CarrierFinancialInvoice> = {}): CarrierFinancialInvoice => ({
  id: 1, amount: "100.01", status: "funded", invoiceDate: "2026-10-01T18:00:00Z",
  createdAt: "2026-10-01T18:00:00Z", fundedAt: "2026-10-01T18:00:00Z",
  loadType: "otr", chargebackStatus: "none", ...patch,
});
test("empty broker has zero money/counts, unknown DSO and grade, and no invented credit history", () => {
  const result = buildBrokerFinancialSummary([], [], [], [], null, now);
  assert.equal(result.totalInvoiced, 0);
  assert.equal(result.openAr, 0);
  assert.equal(result.chargebackCount, 0);
  assert.equal(result.averageDaysToPay, null);
  assert.equal(result.creditGrade, null);
  assert.deepEqual(result.creditHistory, []);
  assert.equal(result.months.length, 6);
});
test("invoiced amount includes issued unfunded invoices, not rejected, drafts, or future invoices", () => {
  const result = buildBrokerFinancialSummary([
    invoice(), invoice({ id: 2, status: "under_review", fundedAt: null, chargebackStatus: "charged" }),
    invoice({ id: 3, status: "draft", fundedAt: null }), invoice({ id: 4, status: "rejected", fundedAt: null }),
    invoice({ id: 5, invoiceDate: "2026-11-01T18:00:00Z" }),
  ], [], [], [], "D", now);
  assert.equal(result.totalInvoiced, 200.02);
  assert.equal(result.chargebackCount, 1);
  assert.equal(result.creditGrade, "D");
  assert.equal(result.months[5].invoices, 2);
});
test("all cash payments determine full-payment DSO; partial payments alone do not", () => {
  const result = buildBrokerFinancialSummary([invoice(), invoice({ id: 2 })], [
    { invoiceId: 1, amount: "40.01", paymentDate: "2026-10-02T18:00:00Z" },
    { invoiceId: 1, amount: "60", paymentDate: "2026-10-11T18:00:00Z" },
    { invoiceId: 2, amount: "60", paymentDate: "2026-10-11T18:00:00Z" },
  ], [{ outstanding: 40.01, ageDays: 29 }], [], "A", now);
  assert.equal(result.averageDaysToPay, 10);
  assert.equal(result.months[5].paidInvoices, 1);
  assert.equal(result.openAr, 40.01);
  assert.equal(result.aging[1].amount, 40.01);
});
test("credit history is chronological, ordinal grade values retain actual scores, no current-grade interpolation", () => {
  const result = buildBrokerFinancialSummary([], [], [], [
    { grade: "D", score: 25, calculatedAt: "2026-10-03T18:00:00Z" },
    { grade: "A", score: 90, calculatedAt: "2026-10-01T18:00:00Z" },
    { grade: "B", score: 75, calculatedAt: "2026-11-01T18:00:00Z" },
    { grade: "INVALID", score: 1, calculatedAt: "2026-10-02T18:00:00Z" },
  ], "F", now);
  assert.deepEqual(result.creditHistory.map(row => [row.grade, row.gradeValue, row.score]), [["A", 5, 90], ["D", 2, 25]]);
  assert.equal(result.creditGrade, "F");
});
test("AR bucket totals reconcile to open AR at every boundary", () => {
  const result = buildBrokerFinancialSummary([], [], [0, 1, 30, 31, 60, 61, 90, 91].map(ageDays => ({ ageDays, outstanding: 0.1 })), [], null, now);
  assert.deepEqual(result.aging.map(row => row.amount), [0.1, 0.2, 0.2, 0.2, 0.1]);
  assert.equal(result.openAr, 0.8);
});

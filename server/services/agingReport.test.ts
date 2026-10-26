import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  agingBucket, agingReportCsv, agingReportFiltersSchema, AGING_COLUMNS, groupAgingRows,
  type AgingSourceRow, type GroupedAgingReport,
} from "../../shared/aging-report";
import { getConfirmationAgingRows, getConfirmationInvoiceScope } from "./brokerConfirmationService";
import { pool } from "../db";

after(() => pool.end());
function invoice(values: Partial<AgingSourceRow> = {}): AgingSourceRow {
  return {
    invoiceId: 1, invoiceNumber: "INV-1", carrierId: 1, carrier: "Alpha Carrier",
    brokerId: 1, debtorId: null, broker: "Zed Broker", amount: 100, outstanding: 50,
    fundedAt: new Date("2026-10-26T16:00:00Z"), status: "funded", ageDays: 1, loadType: "otr_load",
    confirmationStatus: "pending", ...values,
  };
}
function reconciles(report: GroupedAgingReport) {
  const cents = (amount: number) => Math.round(amount * 100);
  for (const row of report.rows)
    assert.equal(cents(row.total), AGING_COLUMNS.reduce((sum, { key }) => sum + cents(row.buckets[key]), 0));
  for (const { key } of AGING_COLUMNS)
    assert.equal(cents(report.totals.buckets[key]), report.rows.reduce((sum, row) => sum + cents(row.buckets[key]), 0));
  assert.equal(cents(report.totals.total), report.rows.reduce((sum, row) => sum + cents(row.total), 0));
  assert.equal(report.totals.invoiceCount, report.invoices.length);
}

test("five aging buckets have no day-0/day-90 boundary overlaps", () => {
  const ages = [0, 1, 30, 31, 60, 61, 90, 91];
  assert.deepEqual(ages.map(agingBucket), ["current", "days1to30", "days1to30", "days31to60",
    "days31to60", "days61to90", "days61to90", "over90"]);
  const rows = ages.map((ageDays, index) => invoice({ invoiceId: index + 1, ageDays, outstanding: 10.01 }));
  for (const view of ["carrier", "broker"]) {
    const report = groupAgingRows(rows, { view });
    assert.equal(report.rows.length, 1);
    assert.deepEqual(report.rows[0].buckets, { current: 10.01, days1to30: 20.02, days31to60: 20.02, days61to90: 20.02, over90: 10.01 });
    assert.equal(report.totals.total, 80.08);
    reconciles(report);
  }
});
test("entity IDs, not matching names, define groups; debtor and broker IDs do not collide", () => {
  const rows = [
    invoice({ carrierId: 1, carrier: "Same Name", brokerId: 7 }),
    invoice({ invoiceId: 2, carrierId: 2, carrier: "Same Name", brokerId: null, debtorId: 7 }),
  ];
  assert.equal(groupAgingRows(rows, { view: "carrier" }).rows.length, 2);
  assert.deepEqual(groupAgingRows(rows, { view: "broker" }).rows.map(row => row.id).sort(), ["broker:7", "debtor:7"]);
  assert.equal(groupAgingRows([invoice({ carrier: "__proto__" })], { view: "carrier" }).rows[0].total, 50);
});
test("combined filters use selected entity, Denver funded dates, invoice outstanding, status and load type", () => {
  const rows = [
    invoice({ invoiceId: 1, amount: 200, status: "held", loadType: "hotshot", fundedAt: new Date("2026-10-27T01:30:00Z") }),
    invoice({ invoiceId: 2, status: "held", loadType: "hotshot", fundedAt: new Date("2026-10-27T07:00:00Z") }),
    invoice({ invoiceId: 3, carrier: "Beta Carrier", status: "held", loadType: "hotshot" }),
    invoice({ invoiceId: 4, status: "funded", loadType: "hotshot" }),
    invoice({ invoiceId: 5, status: "held", loadType: "dump_truck_ticket" }),
  ];
  const report = groupAgingRows(rows, {
    view: "carrier", search: " ALPHA ", startDate: "2026-10-26", endDate: "2026-10-26",
    minAmount: 50, maxAmount: 50, status: "held", loadType: "hotshot",
  });
  assert.deepEqual(report.invoices.map(row => row.invoiceId), [1]);
  assert.equal(report.totals.total, 50);
  assert.equal(report.invoices[0].amount, 200);
  assert.equal(groupAgingRows(rows, { view: "broker", search: "zEd" }).totals.invoiceCount, 5);
  assert.equal(groupAgingRows(rows, { view: "broker", search: "Alpha" }).totals.invoiceCount, 0);
  reconciles(report);
});
test("OTR, Dump, Hotshot and Other map to the existing load types, including legacy/null Other", () => {
  const rows = ["otr_load", "dump_truck_ticket", "hotshot", "other", null, "legacy"].map((loadType, index) => invoice({ invoiceId: index + 1, loadType }));
  for (const loadType of ["otr_load", "dump_truck_ticket", "hotshot"]) {
    assert.equal(groupAgingRows(rows, { view: "carrier", loadType }).totals.invoiceCount, 1);
  }
  assert.equal(groupAgingRows(rows, { view: "carrier", loadType: "other" }).totals.invoiceCount, 3);
});
test("empty filters and zero/closed balances produce zero totals rather than stale data", () => {
  const report = groupAgingRows([invoice({ outstanding: 0 }), invoice({ fundedAt: null })], { view: "carrier" });
  assert.equal(report.rows.length, 0);
  assert.equal(report.totals.total, 0);
  assert.equal(report.invoices.length, 0);
  reconciles(report);
  assert.match(agingReportCsv(report), /"TOTAL","0","0.00"/);
});
test("filter validation rejects malformed dates, reversed ranges, non-finite amounts and unsupported values", () => {
  for (const filters of [
    { startDate: "2026-02-29" }, { startDate: "2026-10-27", endDate: "2026-10-26" },
    { minAmount: "Infinity" }, { minAmount: -1 }, { minAmount: 2, maxAmount: 1 },
    { status: "bogus" }, { loadType: "OTR" }, { view: "invalid" }, { search: ["one", "two"] },
  ]) assert.equal(agingReportFiltersSchema.safeParse({ view: "carrier", ...filters }).success, false);
  assert.equal(agingReportFiltersSchema.parse({ view: "broker", minAmount: "0", maxAmount: "", startDate: "" }).minAmount, 0);
});
test("CSV uses displayed view/rows/buckets/totals and safely quotes names and formula prefixes", () => {
  const report = groupAgingRows([invoice({ carrier: ' \t=SUM(1,2),"quoted"\nname', outstanding: 10.01 })], { view: "carrier" });
  const csv = agingReportCsv(report);
  assert.match(csv, /Trucking Pros Financial/);
  assert.match(csv, /By Carrier/);
  assert.match(csv, /"Current","1–30","31–60","61–90","90\+"/);
  assert.match(csv, /"'\s+=SUM/);
  assert.match(csv, /""quoted""/);
  assert.match(csv, /"TOTAL","1","0.00","10.01","0.00","0.00","0.00","10.01"/);
  const broker = groupAgingRows([invoice()], { view: "broker" });
  assert.match(agingReportCsv(broker), /"By Broker"/);
});
test("grouped views reconcile with the unchanged scoped database aging source", async () => {
  const source = await getConfirmationAgingRows();
  const carrier = groupAgingRows(source, { view: "carrier" });
  const broker = groupAgingRows(source, { view: "broker" });
  const expectedCents = source.reduce((sum, row) => sum + Math.round(row.outstanding * 100), 0);
  assert.equal(Math.round(carrier.totals.total * 100), expectedCents);
  assert.equal(Math.round(broker.totals.total * 100), expectedCents);
  reconciles(carrier);
  reconciles(broker);
  const scope = await getConfirmationInvoiceScope({ id: randomUUID(), role: "employee" });
  const privateSource = await getConfirmationAgingRows(scope);
  assert.equal(groupAgingRows(privateSource, { view: "broker" }).rows.length, 0);
});

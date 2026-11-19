import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContractorTime, payrollGrossCents } from "./contractorPayrollMath";
const days = [
  { date: "2024-01-01", startMs: Date.parse("2024-01-01T00:00:00Z"), endMs: Date.parse("2024-01-02T00:00:00Z") },
  { date: "2024-01-02", startMs: Date.parse("2024-01-02T00:00:00Z"), endMs: Date.parse("2024-01-03T00:00:00Z") },
];
function entry(id: number, start: string, end: string | null) {
  return { id, userId: "fixture", clockInTime: start, clockOutTime: end };
}
describe("Contractor payroll arithmetic", () => {
  it("sums each day's actual durations before nearest-minute rounding", () => {
    const result = computeContractorTime([
      entry(1, "2024-01-01T09:00:00Z", "2024-01-01T09:00:20Z"),
      entry(2, "2024-01-01T10:00:00Z", "2024-01-01T10:00:20Z"),
    ], days);
    assert.equal(result.minutes, 1);
    assert.equal(result.hoursDisplay, "0:01");
    assert.equal(result.decimalHours, "0.0167");
  });
  it("splits overnight work at local day boundaries and clips to the period", () => {
    const result = computeContractorTime([entry(1, "2023-12-31T23:00:00Z", "2024-01-01T02:00:00Z"),
      entry(2, "2024-01-01T23:30:00Z", "2024-01-02T01:00:00Z")], days);
    assert.deepEqual(result.daily.map(day => day.minutes), [150, 60]);
    assert.equal(result.minutes, 210);
  });
  it("never supplies an assumed clock-out", () => {
    const result = computeContractorTime([entry(1, "2024-01-01T09:00:00Z", null)], days);
    assert.equal(result.minutes, 0);
    assert.ok(result.flags.includes("Missing clock-out"));
    assert.equal(result.entries[0].clockOutTime, null);
  });
  it("flags zero, negative, overlong and overlapping entries", () => {
    const result = computeContractorTime([
      entry(1, "2024-01-01T00:00:00Z", "2024-01-01T17:00:00Z"),
      entry(2, "2024-01-01T12:00:00Z", "2024-01-01T13:00:00Z"),
      entry(3, "2024-01-02T09:00:00Z", "2024-01-02T09:00:00Z"),
      entry(4, "2024-01-02T10:00:00Z", "2024-01-02T08:00:00Z"),
    ], days);
    assert.ok(result.flags.includes("Overlong shift (over 16 hours)"));
    assert.ok(result.flags.includes("Overlapping shifts"));
    assert.ok(result.flags.includes("Zero or negative shift"));
  });
  it("uses actual elapsed time across daylight saving boundaries", () => {
    const result = computeContractorTime([entry(1, "2024-03-10T06:00:00Z", "2024-03-10T10:00:00Z")],
      [{ date: "2024-03-10", startMs: Date.parse("2024-03-10T05:00:00Z"), endMs: Date.parse("2024-03-11T04:00:00Z") }]);
    assert.equal(result.minutes, 240);
  });
  it("rounds pay to integer cents with no deductions or overtime multiplier", () => {
    assert.equal(payrollGrossCents(481, 2000), 16033);
    assert.equal(payrollGrossCents(60 * 50, 2000), 100000);
    assert.equal(payrollGrossCents(1, 3), 0);
    assert.throws(() => payrollGrossCents(0, 2000));
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { federalHolidays, defaultNoticeDate, localDateTimeToIso, isoToLocalDateTime } from "./holiday-scheduling";
import { BUILT_IN_EMAIL_TEMPLATES } from "./email-templates";

test("all eleven federal holidays use correct actual and observed dates", () => {
  const dates = Object.fromEntries(federalHolidays(2027).map(row => [row.id, row.observedDate]));
  assert.deepEqual(dates, {
    "new-year": "2027-01-01", mlk: "2027-01-18", presidents: "2027-02-15", memorial: "2027-05-31",
    juneteenth: "2027-06-18", independence: "2027-07-05", labor: "2027-09-06",
    "columbus-indigenous": "2027-10-11", veterans: "2027-11-11", thanksgiving: "2027-11-25", christmas: "2027-12-24",
  });
  for (const holiday of federalHolidays(2027)) assert(BUILT_IN_EMAIL_TEMPLATES.some(template => template.id === holiday.templateId));
  assert.equal(federalHolidays(2028)[0].observedDate, "2027-12-31");
  assert.equal(defaultNoticeDate("2027-01-01"), "2026-12-30");
  assert.throws(() => federalHolidays(2101));
});
test("schedule conversion uses explicit IANA zone, handles DST and rejects nonexistent local times", () => {
  assert.equal(localDateTimeToIso("2027-01-15T09:00", "America/Denver"), "2027-01-15T16:00:00.000Z");
  assert.equal(localDateTimeToIso("2027-07-15T09:00", "America/Denver"), "2027-07-15T15:00:00.000Z");
  assert.equal(isoToLocalDateTime("2027-07-15T15:00:00Z", "America/Denver"), "2027-07-15T09:00");
  assert.throws(() => localDateTimeToIso("2027-03-14T02:30", "America/Denver"), /does not exist/);
  assert.equal(localDateTimeToIso("2027-11-07T01:30", "America/Denver"), "2027-11-07T07:30:00.000Z");
  assert.throws(() => localDateTimeToIso("2027-02-30T12:00", "America/Denver"));
  assert.throws(() => localDateTimeToIso("2027-01-15T09:00", "not-a-zone"));
});

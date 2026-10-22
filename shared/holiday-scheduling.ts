export type FederalHoliday = { id: string; name: string; date: string; observedDate: string; templateId: string };
const dateString = (date: Date) => date.toISOString().slice(0, 10);
const day = (year: number, month: number, date: number) => new Date(Date.UTC(year, month - 1, date));
function nthMonday(year: number, month: number, nth: number) {
  const first = day(year, month, 1);
  return day(year, month, 1 + (8 - first.getUTCDay()) % 7 + (nth - 1) * 7);
}
export function federalHolidays(year: number): FederalHoliday[] {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Choose a year between 2020 and 2100.");
  const memorial = day(year, 6, 0);
  memorial.setUTCDate(memorial.getUTCDate() - (memorial.getUTCDay() + 6) % 7);
  const thanksgiving = day(year, 11, 1);
  thanksgiving.setUTCDate(1 + (11 - thanksgiving.getUTCDay()) % 7 + 21);
  const rows: [string, string, Date, boolean][] = [
    ["new-year", "New Year's Day", day(year, 1, 1), true],
    ["mlk", "Martin Luther King Jr. Day", nthMonday(year, 1, 3), false],
    ["presidents", "Presidents' Day", nthMonday(year, 2, 3), false],
    ["memorial", "Memorial Day", memorial, false],
    ["juneteenth", "Juneteenth", day(year, 6, 19), true],
    ["independence", "Independence Day", day(year, 7, 4), true],
    ["labor", "Labor Day", nthMonday(year, 9, 1), false],
    ["columbus-indigenous", "Columbus / Indigenous Peoples' Day", nthMonday(year, 10, 2), false],
    ["veterans", "Veterans Day", day(year, 11, 11), true],
    ["thanksgiving", "Thanksgiving", thanksgiving, false],
    ["christmas", "Christmas", day(year, 12, 25), true],
  ];
  return rows.map(([id, name, actual, fixed]) => {
    const observed = new Date(actual);
    if (fixed && actual.getUTCDay() === 6) observed.setUTCDate(observed.getUTCDate() - 1);
    if (fixed && actual.getUTCDay() === 0) observed.setUTCDate(observed.getUTCDate() + 1);
    return { id, name, date: dateString(actual), observedDate: dateString(observed), templateId: `holiday-${id}` };
  });
}
export function defaultNoticeDate(observedDate: string, daysBefore = 2): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedDate) || !Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365) {
    throw new Error("Choose a valid observed date and notice lead time.");
  }
  const date = new Date(`${observedDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysBefore);
  return dateString(date);
}
export function isoToLocalDateTime(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function localDateTimeToIso(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a complete local date and time.");
  const utc = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(utc)) throw new Error("Invalid date and time.");
  // Candidate offsets are derived from the target IANA zone, not the browser's
  // zone. Search both sides of a DST transition; a repeated hour uses the first.
  const candidates = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = utc + hours * 3600000;
    const local = isoToLocalDateTime(new Date(probe).toISOString(), timeZone);
    const offset = new Date(`${local}:00Z`).getTime() - probe;
    candidates.add(utc - offset);
  }
  const matches = [...candidates].filter(candidate => isoToLocalDateTime(new Date(candidate).toISOString(), timeZone) === value).sort((a, b) => a - b);
  if (!matches.length) throw new Error("That local time does not exist in this time zone (daylight-saving change). Choose another time.");
  return new Date(matches[0]).toISOString();
}

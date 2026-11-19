import type { PayDay, PayrollTimeEntry } from "../../shared/contractor-payroll";
export interface PayrollDayBoundary { date: string; startMs: number; endMs: number }
export function computeContractorTime(entries: Omit<PayrollTimeEntry, "flags">[], days: PayrollDayBoundary[]) {
  const daily: PayDay[] = days.map(day => ({ date: day.date, minutes: 0 }));
  const milliseconds = days.map(() => 0);
  const checked = entries.map(entry => ({ ...entry, flags: [] as string[] }));
  for (const entry of checked) {
    const start = Date.parse(entry.clockInTime);
    const end = entry.clockOutTime === null ? NaN : Date.parse(entry.clockOutTime);
    if (!Number.isFinite(start)) entry.flags.push("Invalid clock-in");
    if (entry.clockOutTime === null) entry.flags.push("Missing clock-out");
    else if (!Number.isFinite(end) || end <= start) entry.flags.push("Zero or negative shift");
    else if (end - start > 16 * 3600000) entry.flags.push("Overlong shift (over 16 hours)");
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      days.forEach((day, index) => { milliseconds[index] += Math.max(0, Math.min(end, day.endMs) - Math.max(start, day.startMs)); });
    }
  }
  const sorted = checked.filter(e => Number.isFinite(Date.parse(e.clockInTime)))
    .sort((a, b) => Date.parse(a.clockInTime) - Date.parse(b.clockInTime));
  for (let i = 0; i < sorted.length; i++) {
    const left = sorted[i], end = left.clockOutTime ? Date.parse(left.clockOutTime) : Infinity;
    for (let j = i + 1; j < sorted.length && Date.parse(sorted[j].clockInTime) < end; j++) {
      if (!left.flags.includes("Overlapping shifts")) left.flags.push("Overlapping shifts");
      if (!sorted[j].flags.includes("Overlapping shifts")) sorted[j].flags.push("Overlapping shifts");
    }
  }
  daily.forEach((day, index) => { day.minutes = Math.round(milliseconds[index] / 60000); });
  const minutes = daily.reduce((sum, day) => sum + day.minutes, 0);
  const flags = [...new Set(checked.flatMap(e => e.flags))];
  if (minutes === 0) flags.push("No payable minutes");
  return { daily, entries: checked, minutes, flags, decimalHours: (minutes / 60).toFixed(4), hoursDisplay: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` };
}
export function payrollGrossCents(minutes: number, rateCents: number) {
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || !Number.isSafeInteger(rateCents) || rateCents <= 0) throw Error("Invalid payroll amounts");
  const result = (BigInt(minutes) * BigInt(rateCents) + 30n) / 60n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Payroll amount exceeds safe limits");
  return Number(result);
}

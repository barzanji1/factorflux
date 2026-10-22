import { useMemo, useState } from "react";
import { CalendarDays, Clock3, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { federalHolidays, defaultNoticeDate, localDateTimeToIso } from "../../../../shared/holiday-scheduling";

const DEFAULT_ZONE = "America/Denver";
const dateLabel = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
};

export function HolidayYearPlanner({ onReview }: {
  onReview: (holiday: ReturnType<typeof federalHolidays>[number], localDateTime: string, timeZone: string) => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [timeZone, setTimeZone] = useState(DEFAULT_ZONE);
  const [noticeTime, setNoticeTime] = useState("09:00");
  const [leadDays, setLeadDays] = useState(2);
  const [proposedTimes, setProposedTimes] = useState<Record<string, string>>({});
  const yearValid = Number.isInteger(year) && year >= 2020 && year <= 2100;
  const leadValid = Number.isInteger(leadDays) && leadDays >= 0 && leadDays <= 365;
  const plannerIssue = !yearValid ? "Choose a year between 2020 and 2100." : !leadValid ? "Lead days must be a whole number from 0 to 365." : "";
  const holidays = useMemo(() => yearValid ? federalHolidays(year) : [], [year, yearValid]);
  const rows = useMemo(() => leadValid ? holidays.map((holiday) => {
    const date = defaultNoticeDate(holiday.observedDate, leadDays);
    return { holiday, value: proposedTimes[`${year}:${holiday.id}`] || `${date}T${noticeTime}` };
  }) : [], [holidays, leadDays, leadValid, noticeTime, proposedTimes, year]);

  return <section className="border border-[#a5b1ad] bg-[#e4ebe7]">
    <header className="flex items-center gap-2 border-b border-[#bdc9c5] bg-[#d7e2dd] px-3 py-2">
      <CalendarDays className="h-4 w-4 text-[#087f8e]" />
      <div><h3 className="text-xs font-bold text-[#304a52]">Year planner</h3><p className="text-[9px] text-[#657977]">11 notices · each reviewed and confirmed separately</p></div>
    </header>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="holiday-year" className="text-[9px]">Year</Label><Input id="holiday-year" type="number" min={2020} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} className="h-8 rounded-sm bg-white text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-zone" className="text-[9px]">Time zone (IANA)</Label><Input id="holiday-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder={DEFAULT_ZONE} className="h-8 rounded-sm bg-white text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-time" className="text-[9px]">Notice time</Label><Input id="holiday-time" type="time" value={noticeTime} onChange={(event) => setNoticeTime(event.target.value)} className="h-8 rounded-sm bg-white text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-lead" className="text-[9px]">Lead days</Label><Input id="holiday-lead" type="number" min={0} max={365} value={leadDays} onChange={(event) => setLeadDays(Number(event.target.value))} className="h-8 rounded-sm bg-white text-xs" /></div>
      </div>
      {plannerIssue && <p role="alert" className="border border-[#d3a49e] bg-[#fff1ee] p-2 text-[9px] text-[#8d433a]">{plannerIssue}</p>}
      <p className="border border-[#c9b77c] bg-[#fff8e9] px-2.5 py-2 text-[9px] leading-relaxed text-[#765f30]">
        Review the observed closure date and message for each notice. “Review notice” loads its holiday template and date into the composer; it does not queue or send anything.
      </p>
      <div className="max-h-[390px] space-y-1 overflow-auto">
        {rows.map(({ holiday, value }) => {
          let issue = "";
          let isFuture = false;
          try {
            isFuture = new Date(localDateTimeToIso(value, timeZone)).getTime() > Date.now();
          } catch (error) {
            issue = error instanceof Error ? error.message : "Enter a valid local date and IANA time zone.";
          }
          return <div key={holiday.id} className="grid gap-2 border border-[#c6d0cd] bg-[#f8faf8] p-2 sm:grid-cols-[minmax(120px,.8fr)_minmax(150px,1fr)_minmax(200px,1.2fr)_auto] sm:items-center">
            <div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#304a52]">{holiday.name}</p><p className="text-[9px] text-[#758582]">Actual {dateLabel(holiday.date)}</p></div>
            <div><p className="text-[9px] text-[#657977]">Observed closure</p><p className="text-[10px] font-semibold text-[#304a52]">{dateLabel(holiday.observedDate)}</p></div>
            <div className="space-y-1">
              <Label htmlFor={`holiday-notice-${holiday.id}`} className="sr-only">Proposed notice date and time for {holiday.name}</Label>
              <Input id={`holiday-notice-${holiday.id}`} type="datetime-local" value={value} onChange={(event) => setProposedTimes((current) => ({ ...current, [`${year}:${holiday.id}`]: event.target.value }))} className="h-8 rounded-sm bg-white text-[10px]" />
              {issue && <p role="alert" className="text-[9px] text-[#8d433a]">{issue}</p>}
              {!issue && !isFuture && <p className="text-[9px] text-[#8d433a]">Past notice time — choose a future time.</p>}
            </div>
            <Button type="button" size="sm" variant="outline" disabled={!isFuture || !!issue} onClick={() => onReview(holiday, value, timeZone)} className="h-8 rounded-sm px-2 text-[9px]"><Eye className="mr-1 h-3 w-3" />Review notice</Button>
          </div>;
        })}
      </div>
      <p className="flex items-center gap-1 text-[9px] text-[#758582]"><Clock3 className="h-3 w-3" />Each holiday is a separate schedule with its own preview and explicit confirmation.</p>
    </div>
  </section>;
}

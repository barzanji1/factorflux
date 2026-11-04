import { useMemo, useState } from "react";
import { CalendarDays, Clock3, Eye } from "lucide-react";
import { NeuButton, NeuCard, NeuInput } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
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

  return <section className="rounded-2xl bg-[#e0e0e0] shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
    <header className="flex items-center gap-3 border-b border-[#c9cece] px-4 py-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e0e0e0] text-[#168f9b] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><CalendarDays className="h-4 w-4" /></span>
      <div><h3 className="text-xs font-bold text-[#304a52]">Year planner</h3><p className="text-[9px] text-[#657977]">11 notices · each reviewed and confirmed separately</p></div>
    </header>
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="holiday-year" className="text-[9px]">Year</Label><NeuInput id="holiday-year" type="number" min={2020} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} className="min-h-10 h-10 px-3 text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-zone" className="text-[9px]">Time zone (IANA)</Label><NeuInput id="holiday-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder={DEFAULT_ZONE} className="min-h-10 h-10 px-3 text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-time" className="text-[9px]">Notice time</Label><NeuInput id="holiday-time" type="time" value={noticeTime} onChange={(event) => setNoticeTime(event.target.value)} className="min-h-10 h-10 px-3 text-xs" /></div>
        <div className="space-y-1"><Label htmlFor="holiday-lead" className="text-[9px]">Lead days</Label><NeuInput id="holiday-lead" type="number" min={0} max={365} value={leadDays} onChange={(event) => setLeadDays(Number(event.target.value))} className="min-h-10 h-10 px-3 text-xs" /></div>
      </div>
      {plannerIssue && <NeuNotice severity="ack" role="alert" className="text-[9px]">{plannerIssue}</NeuNotice>}
      <p className="rounded-xl bg-[#e0e0e0] px-3 py-2.5 text-[9px] leading-relaxed text-[#765f30] shadow-[inset_4px_4px_8px_#c7bca3,inset_-4px_-4px_8px_#fff9eb]">
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
          return <NeuCard key={holiday.id} pressed className="grid gap-3 p-3 sm:grid-cols-[minmax(120px,.8fr)_minmax(150px,1fr)_minmax(200px,1.2fr)_auto] sm:items-center">
            <div className="min-w-0"><p className="truncate text-[10px] font-bold text-[#304a52]">{holiday.name}</p><p className="text-[9px] text-[#758582]">Actual {dateLabel(holiday.date)}</p></div>
            <div><p className="text-[9px] text-[#657977]">Observed closure</p><p className="text-[10px] font-semibold text-[#304a52]">{dateLabel(holiday.observedDate)}</p></div>
            <div className="space-y-1">
              <Label htmlFor={`holiday-notice-${holiday.id}`} className="sr-only">Proposed notice date and time for {holiday.name}</Label>
              <NeuInput id={`holiday-notice-${holiday.id}`} type="datetime-local" value={value} onChange={(event) => setProposedTimes((current) => ({ ...current, [`${year}:${holiday.id}`]: event.target.value }))} className="min-h-10 h-10 px-3 text-[10px]" />
              {issue && <p role="alert" className="text-[9px] text-[#8d433a]">{issue}</p>}
              {!issue && !isFuture && <p className="text-[9px] text-[#8d433a]">Past notice time — choose a future time.</p>}
            </div>
            <NeuButton type="button" disabled={!isFuture || !!issue} onClick={() => onReview(holiday, value, timeZone)} className="min-h-10 px-3 text-[9px]"><Eye className="h-3 w-3" />Review notice</NeuButton>
          </NeuCard>;
        })}
      </div>
      <p className="flex items-center gap-1 text-[9px] text-[#758582]"><Clock3 className="h-3 w-3" />Each holiday is a separate schedule with its own preview and explicit confirmation.</p>
    </div>
  </section>;
}

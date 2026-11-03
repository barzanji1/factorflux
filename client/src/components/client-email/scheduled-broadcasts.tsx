import { CalendarClock, Eye, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NeuBadge } from "@/styles/neu";
import type { BroadcastSummary } from "../../../../shared/email-broadcast";

export type ScheduledBroadcast = Omit<BroadcastSummary, "status"> & {
  status: BroadcastSummary["status"] | "scheduled";
  scheduledAt: string | null;
  scheduleTimeZone: string;
  dispatchStartedAt: string | null;
  revision: number;
  error: string | null;
  clientIds?: number[] | null;
};

const zonedTime = (iso: string | null, zone: string) => {
  if (!iso) return "Time not set";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return `${iso} · ${zone}`;
  }
};

export function ScheduledBroadcasts({
  items, loading, error, cancellingId, onRetry, onSelect, onEdit, onCancel,
}: {
  items: ScheduledBroadcast[];
  loading: boolean;
  error?: string;
  cancellingId: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onEdit: (item: ScheduledBroadcast) => void;
  onCancel: (id: string) => void;
}) {
  return <section className="border border-[#a5b1ad] bg-[#e4ebe7]">
    <header className="flex items-center justify-between gap-2 border-b border-[#bdc9c5] bg-[#d7e2dd] px-3 py-2">
      <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-[#087f8e]" /><div><h3 className="text-xs font-bold text-[#304a52]">Scheduled broadcasts</h3><p className="text-[9px] text-[#657977]">Confirmed schedules and drafts awaiting confirmation</p></div></div>
      <span className="border border-[#c9b77c] bg-[#fff8e9] px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-[#765f30]">Confirm every draft</span>
    </header>
    <div className="max-h-[440px] space-y-2 overflow-auto p-2.5">
      {loading ? <div className="space-y-2" aria-label="Loading scheduled broadcasts"><div className="h-16 animate-pulse border border-[#c6d0cd] bg-[#f4f7f5]" /><div className="h-16 animate-pulse border border-[#c6d0cd] bg-[#f4f7f5]" /></div>
        : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-2.5 text-[10px] text-[#8d433a]"><span>{error}</span><Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button></div>
          : !items.length ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-3 py-6 text-center"><CalendarClock className="mx-auto mb-1.5 h-5 w-5 text-[#849794]" /><p className="text-[10px] font-semibold text-[#536a6d]">Nothing scheduled</p><p className="mt-1 text-[9px] text-[#7b8b89]">A schedule is saved only after its own preview and confirmation.</p></div>
            : items.map((item) => {
              const editable = !!item.scheduledAt && new Date(item.scheduledAt).getTime() > Date.now()
                && !item.dispatchStartedAt && (item.status === "scheduled" || item.status === "draft");
              const audience = item.clientIds?.length
                ? `${item.clientIds.length} selected client${item.clientIds.length === 1 ? "" : "s"}`
                : Object.entries(item.filters || {}).length
                  ? Object.entries(item.filters).map(([key, value]) => `${key}: ${value}`).join(" · ")
                  : "All clients (filters re-evaluated at send time)";
              return <article key={item.id} className="border border-[#c6d0cd] bg-[#f8faf8]">
                <div className="flex flex-wrap items-start gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5"><NeuBadge tone={item.status === "failed" ? "warning" : item.status === "scheduled" || item.status === "queued" || item.status === "sending" ? "accent" : item.status === "completed" ? "success" : "neutral"} className={`px-2 py-0.5 text-[8px] uppercase tracking-wide ${item.status === "failed" ? "text-[#a3483e]" : ""}`}>{item.status}</NeuBadge><span className="font-mono text-[8px] text-[#758582]">rev {item.revision}</span></div>
                    <p className="truncate text-[10px] font-bold text-[#304a52]">{item.subject || "(No subject)"}</p>
                    <p className="mt-0.5 text-[9px] font-semibold text-[#326572]">{zonedTime(item.scheduledAt, item.scheduleTimeZone || "America/Denver")} <span className="font-normal text-[#758582]">({item.scheduleTimeZone || "America/Denver"})</span></p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[9px] leading-relaxed text-[#657977]">{item.body}</p>
                    <p className="mt-1 text-[9px] text-[#758582]">Audience: {audience} · current estimate {item.counts.sendable} sendable / {item.counts.skipped} skipped</p>
                    <p className="mt-1 border-l-2 border-[#d5b77b] pl-2 text-[8px] leading-relaxed text-[#765f30]">Filter audiences are evaluated again at send time; the total may change. Explicit client selection stays limited to those IDs.</p>
                    {item.error && <p role="alert" className="mt-1 text-[9px] text-[#8d433a]">{item.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button type="button" size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[9px]" onClick={() => onSelect(item.id)}><Eye className="mr-1 h-3 w-3" />Details</Button>
                    {editable && <Button type="button" size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[9px]" onClick={() => onEdit(item)}><Pencil className="mr-1 h-3 w-3" />Edit</Button>}
                    {(item.status === "scheduled" || item.status === "draft" || item.status === "queued" || item.status === "sending") && <Button type="button" size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[9px] text-[#8d433a]" disabled={cancellingId === item.id} onClick={() => onCancel(item.id)}><X className="mr-1 h-3 w-3" />{cancellingId === item.id ? "Cancelling…" : "Cancel"}</Button>}
                  </div>
                </div>
              </article>;
            })}
    </div>
  </section>;
}

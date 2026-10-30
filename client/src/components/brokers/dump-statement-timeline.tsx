import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, FileText, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NeuBadge, NeuButton } from "@/styles/neu/components";

interface StatementHistoryEvent {
  id: number;
  eventType: string;
  createdAt: string;
  label: string;
  statementId: string | null;
  invoiceCount: number | null;
  totalBalance: string | null;
  status: string | null;
  messageId: string | null;
  error: string | null;
  downloadUrl: string | null;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      });
}

function formatAmount(value: string | null) {
  if (value == null || value.trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : value;
}

function eventTone(event: StatementHistoryEvent, neuStyle = false) {
  if (neuStyle) {
    if (event.eventType === "broker_dump_statement_failed" || event.error) return "text-[#a34e48]";
    if (event.eventType === "broker_dump_statement_skipped") return "text-[#9b6a22]";
    return "text-[#168d98]";
  }
  if (event.eventType === "broker_dump_statement_failed" || event.error) {
    return "border-red-300 bg-red-50 text-red-800";
  }
  if (event.eventType === "broker_dump_statement_skipped") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-[#80a6a9] bg-[#e6f1ef] text-[#245b60]";
}

export default function DumpStatementTimeline({ brokerId, neuStyle = false }: { brokerId: number; neuStyle?: boolean }) {
  const query = useQuery<StatementHistoryEvent[]>({
    queryKey: ["/api/brokers", brokerId, "statement-history"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/brokers/${brokerId}/statement-history`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error("Unable to load statement history.");
      return response.json();
    },
    enabled: Number.isFinite(brokerId),
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (query.isLoading) {
    return (
      <section aria-label="Dump statement timeline" className="space-y-3" data-testid="dump-statement-timeline-loading">
        <div className={`h-5 w-48 animate-pulse ${neuStyle ? "rounded-lg bg-[#d2d2d2]" : "bg-slate-200"}`} />
        {[0, 1, 2].map(item => <div key={item} className={`h-20 animate-pulse rounded-xl ${neuStyle ? "bg-[#d2d2d2]" : "border border-slate-200 bg-slate-100"}`} />)}
      </section>
    );
  }

  if (query.isError) {
    return (
      <section role="alert" className={neuStyle ? "rounded-2xl bg-[#e0e0e0] p-4 shadow-[4px_4px_9px_#c1c1c1,-4px_-4px_9px_#ffffff]" : "border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4] p-4"} data-testid="dump-statement-timeline-error">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#a13c35]" />
          <div className="min-w-0 flex-1">
            <h3 className={`font-bold ${neuStyle ? "text-[#354548]" : "text-[#303030]"}`}>Statement history is unavailable</h3>
            <p className={`mt-1 text-sm ${neuStyle ? "text-[#667477]" : "text-[#555]"}`}>{query.error instanceof Error ? query.error.message : "Please try again."}</p>
            {neuStyle ? <NeuButton className="mt-3 min-h-9 px-3 text-xs" onClick={() => query.refetch()}><RotateCw className="h-3.5 w-3.5" />Retry</NeuButton> : <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => query.refetch()}><RotateCw className="h-3.5 w-3.5" /> Retry</Button>}
          </div>
        </div>
      </section>
    );
  }

  const events = query.data ?? [];
  if (events.length === 0) {
    return (
      <section className={neuStyle ? "rounded-2xl bg-[#e0e0e0] px-5 py-10 text-center shadow-[inset_4px_4px_9px_#c1c1c1,inset_-4px_-4px_9px_#ffffff]" : "border-2 border-dashed border-[#a0a0a0] bg-[#f4f4f4] px-5 py-10 text-center"} data-testid="dump-statement-timeline-empty">
        <FileText className="mx-auto h-8 w-8 text-[#66888a]" />
        <h3 className={`mt-3 font-bold ${neuStyle ? "text-[#354548]" : "text-[#303030]"}`}>No dump statements yet</h3>
        <p className={`mt-1 text-sm ${neuStyle ? "text-[#667477]" : "text-[#666]"}`}>Sent, skipped, or failed aging statement events will appear here.</p>
      </section>
    );
  }

  return (
    <section aria-label="Dump statement timeline" className="space-y-3" data-testid="dump-statement-timeline">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={`font-bold ${neuStyle ? "text-[#354548]" : "text-slate-800"}`}>Dump statement history</h3>
        <span className={`text-xs ${neuStyle ? "text-[#758587]" : "text-slate-500"}`}>{events.length} {events.length === 1 ? "event" : "events"}</span>
      </div>
      <ol className={neuStyle ? "relative space-y-2 border-l-2 border-[#78c0c4] pl-4 sm:pl-5" : "space-y-3"}>
        {events.map(event => {
          const amount = formatAmount(event.totalBalance);
          return (
            <li key={event.id} className={neuStyle ? "relative" : "border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4]"}>
              {neuStyle && <span className="absolute -left-[22px] top-5 h-3 w-3 rounded-full border-2 border-[#e0e0e0] bg-[#27aab8] shadow-[0_0_0_1px_#27aab8]" />}
              <div className={neuStyle ? "flex flex-col gap-3 rounded-xl bg-[#e0e0e0] p-3 shadow-[4px_4px_9px_#c1c1c1,-4px_-4px_9px_#ffffff] sm:flex-row sm:items-start sm:justify-between" : "flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"}>
                <div className="flex min-w-0 gap-3">
                  {neuStyle ? <NeuBadge tone={eventTone(event, true).includes("a34e") || eventTone(event, true).includes("9b6a") ? "warning" : "accent"} className="mt-0.5 h-fit shrink-0 px-2 py-1 text-[9px] uppercase tracking-wide">{(event.status || event.eventType.replace(/^broker_dump_statement_/, "")).replace(/_/g, " ")}</NeuBadge> : <span className={`mt-0.5 h-fit shrink-0 border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${eventTone(event)}`}>
                    {(event.status || event.eventType.replace(/^broker_dump_statement_/, "")).replace(/_/g, " ")}
                  </span>}
                  <div className="min-w-0">
                    <p className={`font-semibold ${neuStyle ? "text-[#354548]" : "text-slate-800"}`}>{event.label || "Dump statement event"}</p>
                    <time className={`mt-1 block text-xs ${neuStyle ? "text-[#758587]" : "text-slate-500"}`} dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                    <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${neuStyle ? "text-[#667477]" : "text-slate-600"}`}>
                      {event.invoiceCount != null && <span>{event.invoiceCount} {event.invoiceCount === 1 ? "invoice" : "invoices"}</span>}
                      {amount && <span>Total balance {amount}</span>}
                    </div>
                    {event.error && <p className="mt-2 text-sm text-[#a34e48]">{event.error}</p>}
                  </div>
                </div>
                {event.downloadUrl && (
                  <a
                    href={event.downloadUrl}
                    className={neuStyle ? "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#e0e0e0] px-3 py-1.5 text-xs font-semibold text-[#168d98] shadow-[3px_3px_7px_#c1c1c1,-3px_-3px_7px_#ffffff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#27aab8]" : "inline-flex shrink-0 items-center justify-center gap-2 border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#d4d0c8] px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-[#e4e0d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087f8c]"}
                    data-testid={`dump-statement-download-${event.id}`}
                  >
                    <Download className="h-3.5 w-3.5" /> Download PDF
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

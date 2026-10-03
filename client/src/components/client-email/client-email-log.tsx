import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClientEmailLogEntry {
  id: number;
  clientId: number;
  agentId: string | null;
  agentName: string;
  toEmail: string;
  fromEmail: string;
  replyTo: string;
  subject: string;
  body: string;
  status: "pending" | "sending" | "sent" | "failed" | "unconfirmed";
  providerMessageId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  sentAt?: string | null;
  updatedAt: string;
}

const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const statusStyles: Record<string, string> = {
  sent: "border-[#8bbcaf] bg-[#e6f4ed] text-[#28644f]",
  failed: "border-[#d1a19a] bg-[#fff0ed] text-[#97473f]",
  unconfirmed: "border-[#d5b77b] bg-[#fff7e7] text-[#866322]",
  sending: "border-[#a8c5ca] bg-[#edf6f7] text-[#326572]",
  pending: "border-[#c2c9c7] bg-[#f1f3f2] text-[#5b6968]",
};

export function ClientEmailLog({ clientId }: { clientId: number }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useQuery<ClientEmailLogEntry[]>({
    queryKey: ["/api/clients", clientId, "email-log"],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/email-log`, { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load email history");
      if (!Array.isArray(result)) throw new Error("Email history response was invalid");
      return result;
    },
  });
  return <section className="border border-[#9aa7a5] bg-[#edf2ef] shadow-[1px_1px_0_#fff]">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#c4cfcb] bg-[#dfe8e4] px-3 py-2">
      <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-[#087f8e]" /><div><h2 className="text-sm font-bold text-[#263f48]">Client email history</h2><p className="text-[10px] text-[#697c7d]">Sent means accepted by Resend, not confirmed delivery. Replies go to the monitored inbox outside this app.</p></div></div>
      <Button size="sm" variant="outline" className="h-7 rounded-sm px-2 text-[10px]" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={cn("mr-1.5 h-3 w-3", isFetching && "animate-spin")} />Refresh</Button>
    </header>
    <div className="p-3">
      {isLoading ? <div className="space-y-2" aria-label="Loading email history"><div className="h-12 animate-pulse bg-[#dce5e1]" /><div className="h-12 animate-pulse bg-[#dce5e1]" /></div>
        : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-3 text-xs text-[#8d433a]"><span>{(error as Error).message}</span><Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button></div>
          : !data?.length ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-4 py-7 text-center"><Mail className="mx-auto mb-2 h-5 w-5 text-[#849794]" /><p className="text-xs font-semibold text-[#536a6d]">No email activity yet</p><p className="mt-1 text-[10px] text-[#7b8b89]">Messages sent to this client will appear here.</p></div>
            : <div className="space-y-2">{data.map((entry) => {
              const open = expanded === entry.id;
              return <article key={entry.id} className="border border-[#c6d0cd] bg-[#f8faf8]">
                <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : entry.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-left hover:bg-[#eff6f3] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#087f8e]">
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#607674]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#607674]" />}
                  <span className={cn("border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", statusStyles[entry.status] || statusStyles.pending)}>{entry.status}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#304a52]">{entry.subject || "(No subject)"}</span>
                  <span className="text-[10px] text-[#647876]">{dateTime(entry.sentAt || entry.createdAt)}</span>
                  <span className="text-[10px] text-[#73817f]">{entry.agentName || "Staff"}</span>
                </button>
                {open && <div className="space-y-3 border-t border-[#d2dbd8] bg-white/70 p-3 text-xs">
                  <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">To</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.toEmail || "—"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">From</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.fromEmail || "—"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Reply-to</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.replyTo || "—"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Sent by</dt><dd className="mt-0.5 text-[#344f54]">{entry.agentName || "Staff"} · {dateTime(entry.sentAt || entry.createdAt)}</dd></div>
                  </dl>
                  {entry.errorMessage && <p className="border border-[#d4a49d] bg-[#fff1ee] p-2 text-[11px] text-[#8d433a]">{entry.errorMessage}</p>}
                  <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Message</p><p className="whitespace-pre-wrap border border-[#d6dfdc] bg-[#f7f9f7] p-3 leading-relaxed text-[#34494c]">{entry.body || "No message body recorded."}</p></div>
                </div>}
              </article>;
            })}</div>}
    </div>
  </section>;
}
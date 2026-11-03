import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { NeuBadge, NeuCard, NeuButton } from "@/styles/neu";

export interface ClientEmailLogEntry {
  id: number;
  clientId: number;
  agentId: string | null;
  agentName: string;
  toEmail: string;
  ccEmails?: string[];
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
      <NeuButton className="min-h-9 px-3 text-[10px]" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className="h-3 w-3" />Refresh</NeuButton>
    </header>
    <div className="p-3">
      {isLoading ? <div className="space-y-2" aria-label="Loading email history"><div className="h-12 animate-pulse bg-[#dce5e1]" /><div className="h-12 animate-pulse bg-[#dce5e1]" /></div>
        : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#e0e0e0] p-3 text-xs text-[#8d433a] shadow-[inset_4px_4px_8px_#d1b6b2,inset_-4px_-4px_8px_#fff]"><span>{(error as Error).message}</span><NeuButton className="min-h-9 px-3" onClick={() => void refetch()}>Retry</NeuButton></div>
          : !data?.length ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-4 py-7 text-center"><Mail className="mx-auto mb-2 h-5 w-5 text-[#849794]" /><p className="text-xs font-semibold text-[#536a6d]">No email activity yet</p><p className="mt-1 text-[10px] text-[#7b8b89]">Messages sent to this client will appear here.</p></div>
            : <div className="space-y-2">{data.map((entry) => {
              const open = expanded === entry.id;
              return <NeuCard key={entry.id} pressed className="overflow-hidden p-0">
                <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : entry.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-left hover:bg-[#eff6f3] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#087f8e]">
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#607674]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#607674]" />}
                  <NeuBadge tone={entry.status === "sent" ? "success" : entry.status === "failed" ? "warning" : entry.status === "unconfirmed" ? "warning" : "accent"} className={cn("px-2 py-0.5 text-[9px] uppercase tracking-wide", entry.status === "failed" && "text-[#a3483e]")}>{entry.status}</NeuBadge>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#304a52]">{entry.subject || "(No subject)"}</span>
                  <span className="text-[10px] text-[#647876]">{dateTime(entry.sentAt || entry.createdAt)}</span>
                  <span className="text-[10px] text-[#73817f]">{entry.agentName || "Staff"}</span>
                </button>
                {open && <div className="space-y-3 border-t border-[#d2dbd8] bg-white/70 p-3 text-xs">
                  <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">To</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.toEmail || "—"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">From</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.fromEmail || "—"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Reply-to</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.replyTo || "—"}</dd></div>
                    {!!entry.ccEmails?.length && <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">CC</dt><dd className="mt-0.5 break-all text-[#344f54]">{entry.ccEmails.join(", ")}</dd></div>}
                    <div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Sent by</dt><dd className="mt-0.5 text-[#344f54]">{entry.agentName || "Staff"} · {dateTime(entry.sentAt || entry.createdAt)}</dd></div>
                  </dl>
                  {entry.errorMessage && <p className="border border-[#d4a49d] bg-[#fff1ee] p-2 text-[11px] text-[#8d433a]">{entry.errorMessage}</p>}
                  <div><p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#7a8986]">Message</p><p className="whitespace-pre-wrap border border-[#d6dfdc] bg-[#f7f9f7] p-3 leading-relaxed text-[#34494c]">{entry.body || "No message body recorded."}</p></div>
                </div>}
              </NeuCard>;
            })}</div>}
    </div>
  </section>;
}
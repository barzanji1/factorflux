import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  PageShell,
  Win95Button as Button,
  Win95Card as Card,
  Win95Input as Input,
} from "@/components/win95";
import {
  AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download,
  Mail, Paperclip, RefreshCw, Search, Send, ShieldCheck,
} from "lucide-react";

type EmailStatus = "sent" | "delivered" | "bounced" | "complained" | "failed";
type EntityType = "invoice" | "carrier" | "broker" | "chargeback" | "followup";
type EmailAttachment = { filename: string; s3_key: string | null; size: number };
type EmailLogRow = {
  id: string;
  direction: "outbound";
  resendMessageId: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyPreview: string;
  templateName: string | null;
  entityType: EntityType | null;
  entityId: string | null;
  entityUrl: string | null;
  attachments: EmailAttachment[];
  status: EmailStatus;
  statusUpdatedAt: string | null;
  error: string | null;
  sentByUserId: string | null;
  sentByName: string | null;
  createdAt: string;
  canResend: boolean;
  resendDisabledReason: string | null;
  inProgress: boolean;
};
type EmailEvent = { id: string | number; type: string; status: string | null; occurredAt: string; notes: string | null };
type EmailDetail = EmailLogRow & { events: EmailEvent[] };
type EmailList = { rows: EmailLogRow[]; total: number; page: number; pageSize: number };
type Agent = { id: string; name: string };
type ResendResult = { messageId: string; emailLogId: string; warning?: string | null };

const PAGE_SIZE = 25;
const ENTITY_TYPES: EntityType[] = ["invoice", "carrier", "broker", "chargeback", "followup"];
const STATUSES: EmailStatus[] = ["sent", "delivered", "bounced", "complained", "failed"];
const inputClass = "h-9 rounded-sm border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white px-2 text-xs text-[#222] shadow-[inset_1px_1px_2px_rgba(0,0,0,.16)] outline-none focus:ring-2 focus:ring-[#087f8c]/30";

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function prettyDate(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function humanize(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function statusStyle(status: string) {
  if (status === "delivered") return "border-[#71947b] bg-[#dcebdd] text-[#285536]";
  if (status === "bounced" || status === "failed" || status === "complained") return "border-[#b8786e] bg-[#f4dfdb] text-[#812f25]";
  return "border-[#b3954e] bg-[#f5edce] text-[#6b5416]";
}
function addressList(addresses: string[]) {
  return addresses.length ? addresses.join(", ") : "—";
}

export default function EmailLog() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const today = useMemo(() => dateString(new Date()), []);
  const monthAgo = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return dateString(date);
  }, []);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [entityType, setEntityType] = useState("");
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "warning" | "error">("success");

  const params = useMemo(() => {
    const query = new URLSearchParams({ from: from || monthAgo, to: to || today, page: String(page), pageSize: String(PAGE_SIZE) });
    if (entityType) query.set("entityType", entityType);
    if (status) query.set("status", status);
    if (agentId) query.set("agentId", agentId);
    if (search.trim()) query.set("q", search.trim());
    return query.toString();
  }, [from, to, page, entityType, status, agentId, search, monthAgo, today]);
  const listQuery = useQuery<EmailList>({
    queryKey: ["/api/email-log", params],
    queryFn: async () => (await apiRequest("GET", `/api/email-log?${params}`)).json(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const agentsQuery = useQuery<Agent[]>({
    queryKey: ["/api/email-log/agents"],
    queryFn: async () => (await apiRequest("GET", "/api/email-log/agents")).json(),
    retry: false,
  });
  const integrationQuery = useQuery<{ webhookConfigured: boolean }>({
    queryKey: ["/api/email-log/integration-status"],
    queryFn: async () => (await apiRequest("GET", "/api/email-log/integration-status")).json(),
    retry: false,
  });
  const detailQuery = useQuery<EmailDetail>({
    queryKey: ["/api/email-log", expandedId],
    queryFn: async () => (await apiRequest("GET", `/api/email-log/${encodeURIComponent(expandedId!)}`)).json(),
    enabled: !!expandedId,
    retry: false,
  });
  const resend = useMutation({
    mutationFn: async (id: string): Promise<ResendResult> => {
      const response = await apiRequest("POST", `/api/email-log/${encodeURIComponent(id)}/resend`, {});
      return response.json();
    },
    onSuccess: async (result) => {
      if (result.warning) {
        setActionTone("warning");
        setActionMessage(`Resend accepted by the email provider, but entity sync needs attention: ${result.warning}`);
      } else {
        setActionTone("success");
        setActionMessage("A new email log entry was created for the resend.");
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/email-log"] });
    },
    onError: (error: Error) => {
      setActionTone("error");
      setActionMessage(error.message || "Resend could not be completed.");
    },
  });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = listQuery.isLoading;
  const toggleExpanded = (id: string) => {
    setExpandedId(current => current === id ? null : id);
    setActionMessage("");
    setActionTone("success");
  };
  const resetPage = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  const retryResend = (row: EmailLogRow) => {
    if (!row.canResend || row.inProgress || !isManager) return;
    if (window.confirm(`Create a new resend for “${row.subject}”? This will send another email.`)) {
      resend.mutate(row.id);
    }
  };

  return (
    <PageShell title="Email Log" subtitle="Trace outbound messages across invoices, carriers, and recovery work" group="Communications" contentClassName="space-y-4">
      {!integrationQuery.isLoading && integrationQuery.data?.webhookConfigured === false && (
        <div data-testid="email-log-webhook-warning" role="status" className="flex items-start gap-2 border-2 border-[#b3954e] bg-[#fff4cf] px-3 py-2.5 text-xs text-[#614a12] shadow-[1px_1px_0_#808080]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Delivery tracking is not configured.</strong> Email status updates may not appear until the delivery webhook is enabled.</span>
        </div>
      )}

      <Card className="overflow-hidden rounded-sm border-2 border-[#808080] bg-[#f4f4f4] shadow-[2px_2px_0_#808080]">
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-[#808080] bg-[#d4d0c8] px-3 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center border-2 border-l-white border-t-white border-r-[#808080] border-b-[#808080] bg-[#e8e5dd]"><Mail className="h-4 w-4 text-[#087f8c]" /></div>
          <div className="mr-auto">
            <p className="text-sm font-bold leading-tight text-[#222]">Outbound message history</p>
            <p className="text-[10px] text-[#555]">Search recipient and subject · {total.toLocaleString()} records</p>
          </div>
          <Button data-testid="email-log-refresh" size="sm" variant="outline" className="h-8 gap-1 px-2" onClick={() => listQuery.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 border-b border-[#a5a5a5] bg-[#e8e5dd] p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">From
            <Input aria-label="From date" data-testid="email-log-from" type="date" value={from} onChange={e => resetPage(setFrom, e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">To
            <Input aria-label="To date" data-testid="email-log-to" type="date" value={to} onChange={e => resetPage(setTo, e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Entity
            <select aria-label="Filter by entity" data-testid="email-log-entity" value={entityType} onChange={e => resetPage(setEntityType, e.target.value)} className={`${inputClass} mt-1 w-full`}>
              <option value="">All entities</option>{ENTITY_TYPES.map(type => <option key={type} value={type}>{humanize(type)}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Delivery status
            <select aria-label="Filter by status" data-testid="email-log-status" value={status} onChange={e => resetPage(setStatus, e.target.value)} className={`${inputClass} mt-1 w-full`}>
              <option value="">All statuses</option>{STATUSES.map(item => <option key={item} value={item}>{humanize(item)}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Sent by
            <select aria-label="Filter by agent" data-testid="email-log-agent" value={agentId} onChange={e => resetPage(setAgentId, e.target.value)} className={`${inputClass} mt-1 w-full`} disabled={agentsQuery.isLoading || !!agentsQuery.error}>
              <option value="">All senders</option>{agentsQuery.isLoading && <option disabled>Loading senders…</option>}<option value="system">System</option>{(agentsQuery.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            {agentsQuery.error && <span role="status" className="mt-1 block text-[9px] font-normal normal-case text-[#8a3028]">Sender list unavailable; retry the page to reload.</span>}
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555] sm:col-span-2">Recipient or subject
            <span className="relative mt-1 block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#666]" />
              <Input aria-label="Search recipient or subject" data-testid="email-log-search" value={search} onChange={e => resetPage(setSearch, e.target.value)} placeholder="Type an address or subject…" className={`${inputClass} pl-7`} />
            </span>
          </label>
        </div>

        {actionMessage && <div role={actionTone === "success" ? "status" : "alert"} data-testid="email-log-action-message" data-tone={actionTone} className={`border-b px-3 py-2 text-xs ${actionTone === "warning" ? "border-[#b3954e] bg-[#fff4cf] text-[#614a12]" : actionTone === "error" ? "border-[#ad6a60] bg-[#f6e2df] text-[#812f25]" : "border-[#aaa] bg-[#e8f1eb] text-[#285536]"}`}><span className="flex items-start gap-2">{actionTone !== "success" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}{actionMessage}</span></div>}
        <div className="min-h-[280px]">
          {loading ? (
            <div data-testid="email-log-loading" className="space-y-2 p-4" aria-label="Loading email log">
              {[0, 1, 2, 3].map(item => <div key={item} className="grid grid-cols-6 gap-3 border-b border-[#d1cec6] py-3"><div className="h-3 animate-pulse bg-[#d4d0c8]" /><div className="col-span-2 h-3 animate-pulse bg-[#e2dfd7]" /><div className="h-3 animate-pulse bg-[#d4d0c8]" /><div className="col-span-2 h-3 animate-pulse bg-[#e2dfd7]" /></div>)}
            </div>
          ) : listQuery.error ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
              <AlertTriangle className="h-7 w-7 text-[#a54135]" />
              <p className="text-sm font-bold text-[#333]">Email history could not be loaded</p>
              <p className="max-w-lg text-xs text-[#666]">{(listQuery.error as Error).message || "The service is temporarily unavailable."}</p>
              <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>Retry</Button>
            </div>
          ) : rows.length === 0 ? (
            <div data-testid="email-log-empty" className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center border-2 border-[#808080] bg-[#e7e4dc] shadow-[inset_1px_1px_0_white]"><Mail className="h-5 w-5 text-[#777]" /></div>
              <p className="text-sm font-bold text-[#333]">No outbound messages in this view</p>
              <p className="max-w-sm text-xs text-[#666]">Try widening the date range or clearing one of the filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table data-testid="email-log-table" className="w-full min-w-[1000px] border-collapse text-left text-xs">
                <thead className="bg-[#dedbd3] text-[10px] uppercase tracking-wide text-[#444]">
                  <tr>{["Date", "Direction", "To", "Subject", "Entity", "Status", "Sent by"].map(label => <th key={label} className="border-b-2 border-[#888] px-3 py-2 font-bold">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const expanded = expandedId === row.id;
                    const detail = expanded ? detailQuery.data : null;
                    return <FragmentRow key={row.id}>
                      <tr data-testid="email-log-row" aria-expanded={expanded} aria-label={`Email log: ${row.subject}`} tabIndex={0} role="button" onClick={() => toggleExpanded(row.id)} onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleExpanded(row.id); }
                      }} className={`cursor-pointer border-b border-[#d2cfc7] text-[#292929] hover:bg-[#e7f0ee] focus:bg-[#e7f0ee] focus:outline focus:outline-1 focus:outline-[#087f8c] ${expanded ? "bg-[#dce8e6]" : "bg-[#f7f6f2]"}`}>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[10px] tabular-nums">{prettyDate(row.createdAt)}</td>
                        <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1 border border-[#8ba2a2] bg-[#e1eeee] px-1.5 py-0.5 text-[10px] text-[#27565c]"><Send className="h-3 w-3" />Outbound</span></td>
                        <td className="max-w-[210px] truncate px-3 py-2.5" title={addressList(row.toAddresses)}>{addressList(row.toAddresses)}</td>
                        <td className="max-w-[260px] px-3 py-2.5"><span className="flex items-center gap-1.5"><ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} /><span className="truncate font-semibold">{row.subject || "(no subject)"}</span></span></td>
                        <td className="px-3 py-2.5">{row.entityUrl && row.entityType && row.entityId ? <a href={row.entityUrl} onClick={e => e.stopPropagation()} className="font-semibold text-[#087f8c] underline decoration-dotted underline-offset-2 hover:text-[#075b63]">{humanize(row.entityType)} #{row.entityId}</a> : <span className="text-[#777]">{row.entityType && row.entityId ? `${humanize(row.entityType)} #${row.entityId}` : "—"}</span>}</td>
                        <td className="px-3 py-2.5"><span data-testid={`email-log-status-${row.status}`} className={`inline-flex whitespace-nowrap border px-1.5 py-0.5 text-[10px] font-bold ${statusStyle(row.status)}`}>{humanize(row.status)}</span></td>
                        <td className="px-3 py-2.5">{row.sentByName || (row.sentByUserId ? "Unknown sender" : "System")}</td>
                      </tr>
                      {expanded && <tr data-testid="email-log-detail"><td colSpan={7} className="border-b-2 border-[#808080] bg-[#ebe9e2] p-3">
                        {detailQuery.isLoading ? <div className="h-20 animate-pulse border-2 border-[#aaa] bg-[#f6f5f1]" aria-label="Loading message detail" /> : detailQuery.error ? <div role="alert" className="flex items-center gap-2 border border-[#ad6a60] bg-[#f6e2df] p-2 text-xs text-[#812f25]">{(detailQuery.error as Error).message}<Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}>Retry</Button></div> : detail ? (
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]">
                            <section className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ccc] pb-2">
                                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#666]">Message</p><h3 className="mt-1 break-words text-sm font-bold text-[#222]">{detail.subject || "(no subject)"}</h3></div>
                                {isManager && detail.status === "failed" && <div className="flex flex-col items-end gap-1">
                                  <Button data-testid="email-log-resend" size="sm" disabled={!detail.canResend || detail.inProgress || resend.isPending} title={!detail.canResend ? (detail.resendDisabledReason || "This message cannot be safely resent.") : detail.inProgress ? "A resend is already in progress." : undefined} onClick={() => retryResend(detail)}><RefreshCw className="mr-1 h-3.5 w-3.5" />{resend.isPending ? "Resending…" : "Resend"}</Button>
                                  {(!detail.canResend || detail.inProgress) && <p data-testid="email-log-resend-reason" className="max-w-64 text-right text-[10px] text-[#8a3028]">{detail.resendDisabledReason || (detail.inProgress ? "A resend is already in progress." : "This message cannot be safely resent.")}</p>}
                                </div>}
                              </div>
                              <dl className="grid gap-x-4 gap-y-1.5 py-2 text-[11px] sm:grid-cols-[90px_1fr]">
                                <dt className="font-bold text-[#555]">From</dt><dd className="break-all text-[#333]">{detail.fromAddress}</dd>
                                <dt className="font-bold text-[#555]">To</dt><dd className="break-all text-[#333]">{addressList(detail.toAddresses)}</dd>
                                {!!detail.ccAddresses.length && <><dt className="font-bold text-[#555]">CC</dt><dd className="break-all text-[#333]">{addressList(detail.ccAddresses)}</dd></>}
                                <dt className="font-bold text-[#555]">Sent</dt><dd className="text-[#333]">{prettyDate(detail.createdAt)} · {detail.sentByName || (detail.sentByUserId ? "Unknown sender" : "System")}</dd>
                              </dl>
                              <div className="border-t border-[#ccc] pt-2">
                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#666]">Body preview</p>
                                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[#333]">{detail.bodyPreview || "No preview is available."}</p>
                              </div>
                              {!!detail.attachments.length && <div className="mt-3 border-t border-[#ccc] pt-2">
                                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#666]"><Paperclip className="h-3 w-3" />Attachments ({detail.attachments.length})</p>
                                <ul className="space-y-1">{detail.attachments.map((attachment, index) => <li key={`${attachment.filename}-${index}`} className="flex flex-wrap items-center gap-x-2 text-xs">
                                  {attachment.s3_key ? <a data-testid="email-log-attachment" href={`/api/email-log/${encodeURIComponent(detail.id)}/attachments/${index}`} className="font-semibold text-[#087f8c] underline underline-offset-2" onClick={e => e.stopPropagation()}><Download className="mr-1 inline h-3 w-3" />{attachment.filename}</a> : <span data-testid="email-log-attachment-unavailable" className="font-semibold text-[#666]">{attachment.filename} — Unavailable</span>}
                                  <span className="text-[10px] text-[#777]">{attachment.size.toLocaleString()} bytes</span>
                                </li>)}</ul>
                              </div>}
                              {detail.error && <p className="mt-3 border border-[#ad6a60] bg-[#f6e2df] p-2 text-xs text-[#812f25]"><strong>Delivery error:</strong> {detail.error}</p>}
                            </section>
                            <section className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-[#f8f7f3] p-3">
                              <h3 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#555]"><Clock3 className="h-3.5 w-3.5" />Delivery timeline</h3>
                              {detail.events.length ? <ol data-testid="email-log-events" className="space-y-3">
                                {detail.events.map(event => <li key={event.id} className="relative border-l-2 border-[#087f8c] pb-1 pl-3 last:border-l-transparent">
                                  <span className="absolute -left-[5px] top-0.5 h-2 w-2 rounded-full border border-white bg-[#087f8c]" />
                                  <p className="text-xs font-bold text-[#292929]">{humanize(event.type)}{event.status ? ` · ${humanize(event.status)}` : ""}</p>
                                  <p className="mt-0.5 text-[10px] text-[#666]">{prettyDate(event.occurredAt)}</p>
                                  {event.notes && <p className="mt-1 break-words text-[11px] text-[#444]">{event.notes}</p>}
                                </li>)}
                              </ol> : <p className="text-xs text-[#777]">No delivery events have been recorded.</p>}
                              {detail.statusUpdatedAt && <p className="mt-3 border-t border-[#ccc] pt-2 text-[10px] text-[#666]">Status updated {prettyDate(detail.statusUpdatedAt)}</p>}
                            </section>
                          </div>
                        ) : null}
                      </td></tr>}
                    </FragmentRow>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#808080] bg-[#d4d0c8] px-3 py-2">
          <p data-testid="email-log-pagination-label" className="text-[10px] text-[#444]">{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}` : "Showing 0 records"}</p>
          <div className="flex items-center gap-2">
            <Button data-testid="email-log-prev" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous</Button>
            <span data-testid="email-log-page" className="min-w-16 text-center font-mono text-[10px] text-[#333]">Page {page} / {pageCount}</span>
            <Button data-testid="email-log-next" size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
        </div>
      </Card>
      <div className="flex items-center gap-1.5 px-1 text-[10px] text-[#666]"><ShieldCheck className="h-3 w-3 text-[#087f8c]" />Email records are read-only. Resending, when available, creates a separate log entry.</div>
      {integrationQuery.error && <p role="status" className="text-[10px] text-[#7a4c12]">Delivery integration status could not be checked.</p>}
    </PageShell>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

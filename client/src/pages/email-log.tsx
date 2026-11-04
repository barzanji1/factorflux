import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  NeuBadge, NeuButton, NeuCard as Card, NeuCard, NeuInput as Input,
  NeuPageShell, NeuSelect, NeuStatCard, NeuTable, NeuTableBody, NeuTableCell,
  NeuTableHead, NeuTableHeader, NeuTableRow,
} from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { EmailLogCharts, type EmailLogSummary } from "@/components/client-email/email-log-charts";
import "@/components/client-email/email-neu.css";
import {
  AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download,
  Mail, Paperclip, RefreshCw, Search, Send, ShieldCheck,
} from "lucide-react";

type EmailStatus = "sent" | "delivered" | "bounced" | "complained" | "failed";
type EntityType = "invoice" | "carrier" | "broker" | "chargeback" | "followup";
type EmailAttachment = { filename: string; s3_key: string | null; size: number };
type EmailLogRow = {
  id: string | number;
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

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const ENTITY_TYPES: EntityType[] = ["invoice", "carrier", "broker", "chargeback", "followup"];
const STATUSES: EmailStatus[] = ["sent", "delivered", "bounced", "complained", "failed"];
const inputClass = "min-h-10 rounded-xl px-3 text-xs";
const emailIdKey = (id: string | number) => String(id);

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function prettyDate(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function humanize(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}
function addressList(addresses: string[]) {
  return addresses.length ? addresses.join(", ") : "—";
}

export function EmailLogPanel() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryEmailId = new URLSearchParams(queryString).get("emailId");
  const requestedEmailId = queryEmailId && /^\d+$/.test(queryEmailId) ? queryEmailId : null;
  const handledEmailQuery = useRef<string | null>(null);
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
  const [resendTarget, setResendTarget] = useState<EmailLogRow | null>(null);
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
  const summaryParams = useMemo(() => {
    const query = new URLSearchParams({ from: from || monthAgo, to: to || today });
    if (entityType) query.set("entityType", entityType);
    if (status) query.set("status", status);
    if (agentId) query.set("agentId", agentId);
    if (search.trim()) query.set("q", search.trim());
    return query.toString();
  }, [from, to, entityType, status, agentId, search, monthAgo, today]);
  const listQuery = useQuery<EmailList>({
    queryKey: ["/api/email-log", params],
    queryFn: async () => (await apiRequest("GET", `/api/email-log?${params}`)).json(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const summaryQuery = useQuery<EmailLogSummary>({
    queryKey: ["/api/email-log/summary", summaryParams],
    queryFn: async () => (await apiRequest("GET", `/api/email-log/summary?${summaryParams}`)).json(),
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
  useEffect(() => {
    if (!requestedEmailId || handledEmailQuery.current === requestedEmailId) return;
    handledEmailQuery.current = requestedEmailId;
    setExpandedId(requestedEmailId);
    setActionMessage("");
  }, [requestedEmailId]);
  const resend = useMutation({
    mutationFn: async (id: string): Promise<ResendResult> => {
      const response = await apiRequest("POST", `/api/email-log/${encodeURIComponent(id)}/resend`, {});
      return response.json();
    },
    onSuccess: async (result) => {
      setResendTarget(null);
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
  const displayRows = useMemo(() => {
    if (!requestedEmailId || !detailQuery.data || emailIdKey(detailQuery.data.id) !== requestedEmailId) return rows;
    if (rows.some(row => emailIdKey(row.id) === requestedEmailId)) return rows;
    return [detailQuery.data, ...rows];
  }, [requestedEmailId, detailQuery.data, rows]);
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = listQuery.isLoading;
  const toggleExpanded = (id: string | number) => {
    const key = emailIdKey(id);
    setExpandedId(current => current === key ? null : key);
    setActionMessage("");
    setActionTone("success");
  };
  const clearEmailFocus = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setFrom(monthAgo);
    setTo(today);
    setEntityType("");
    setStatus("");
    setAgentId("");
    setSearch("");
    setPage(1);
    setExpandedId(null);
    navigate("/email-log");
  };
  const resetPage = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  const retryResend = (row: EmailLogRow) => {
    if (!row.canResend || row.inProgress || !isManager) return;
    setResendTarget(row);
  };

  return (
    <NeuPageShell className="email-neu email-log-page space-y-5 px-3 py-4 sm:px-5 sm:py-6 xl:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#788587]">Communications / outbound</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-[#344244]">Email log</h1><p className="mt-1 text-sm text-[#747f81]">Trace outbound messages across invoices, carriers, and recovery work.</p></div>
        <NeuBadge tone="accent" className="px-3 py-1.5">Read-only history</NeuBadge>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {([
          ["Total sent", summaryQuery.data?.totals.sent ?? "—", "Accepted by provider", "accent"],
          ["Delivered", summaryQuery.data?.totals.delivered ?? "—", "Delivery confirmed", "success"],
          ["Bounced", summaryQuery.data?.totals.bounced ?? "—", "Address rejected", "warning"],
          ["Failed", summaryQuery.data?.totals.failed ?? "—", "Send not accepted", "error"],
        ] as const).map(([label, value, detail, tone]) => <NeuStatCard key={label} label={label} value={<span className={tone === "success" ? "text-[#248f92]" : tone === "warning" ? "text-[#c77b3e]" : tone === "error" ? "text-[#ba554d]" : "text-[#3b8589]"}>{summaryQuery.isLoading ? <span className="inline-block h-8 w-16 animate-pulse rounded-lg bg-[#d0d0d0]" /> : value}</span>} detail={detail} className="min-h-32 p-4 [&_p.text-3xl]:text-2xl" />)}
      </div>
      {summaryQuery.error && <NeuNotice severity="block" role="alert" data-testid="email-log-summary-error" className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>Summary charts and totals could not be loaded: {(summaryQuery.error as Error).message}</span><NeuButton className="min-h-9 px-3 text-xs" variant="accent" onClick={() => void summaryQuery.refetch()}>Retry summary</NeuButton></NeuNotice>}
      <EmailLogCharts data={summaryQuery.data} loading={summaryQuery.isLoading} error={summaryQuery.error ? (summaryQuery.error as Error).message : undefined} onRetry={() => void summaryQuery.refetch()} from={from} to={to} />
      {!integrationQuery.isLoading && integrationQuery.data?.webhookConfigured === false && (
        <NeuNotice severity="ack" data-testid="email-log-webhook-warning" role="status" className="flex items-start gap-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#bb8742]" />
          <span><strong>Delivery tracking is not configured.</strong> Email status updates may not appear until the delivery webhook is enabled.</span>
        </NeuNotice>
      )}

      {requestedEmailId && (
        <NeuNotice severity={detailQuery.error ? "block" : "info"} data-testid="email-focus-notice" className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span>{detailQuery.error ? `Email #${requestedEmailId} could not be loaded.` : detailQuery.isLoading ? `Loading email #${requestedEmailId}…` : `Email #${requestedEmailId} is expanded, including outside the current filters or page.`}</span>
          <div className="flex items-center gap-3">
            {detailQuery.error && <NeuButton className="min-h-9 px-3 text-xs" onClick={() => detailQuery.refetch()}>Retry</NeuButton>}
            <a href="/email-log" onClick={clearEmailFocus} data-testid="email-log-show-all" className="font-semibold text-[#087f8c] underline underline-offset-2">Show all email</a>
          </div>
        </NeuNotice>
      )}
      <Card className="overflow-hidden rounded-2xl p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#c9cece] px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0e0e0] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><Mail className="h-4 w-4 text-[#168f9b]" /></div>
          <div className="mr-auto">
            <p className="text-sm font-bold leading-tight text-[#222]">Outbound message history</p>
            <p className="text-[10px] text-[#555]">Search recipient and subject · {total.toLocaleString()} records</p>
          </div>
          <NeuButton data-testid="email-log-refresh" className="min-h-9 rounded-xl px-3 text-xs" variant="accent" onClick={() => { void listQuery.refetch(); void summaryQuery.refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </NeuButton>
        </div>
        <div className="grid grid-cols-1 gap-3 border-b border-[#c9cece] p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">From
            <Input aria-label="From date" data-testid="email-log-from" type="date" value={from} onChange={e => resetPage(setFrom, e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">To
            <Input aria-label="To date" data-testid="email-log-to" type="date" value={to} onChange={e => resetPage(setTo, e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Entity
            <NeuSelect aria-label="Filter by entity" data-testid="email-log-entity" value={entityType} onChange={e => resetPage(setEntityType, e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">All entities</option>{ENTITY_TYPES.map(type => <option key={type} value={type}>{humanize(type)}</option>)}
            </NeuSelect>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Delivery status
            <NeuSelect aria-label="Filter by status" data-testid="email-log-status" value={status} onChange={e => resetPage(setStatus, e.target.value)} className={`${inputClass} mt-1`}>
              <option value="">All statuses</option>{STATUSES.map(item => <option key={item} value={item}>{humanize(item)}</option>)}
            </NeuSelect>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555]">Sent by
            <NeuSelect aria-label="Filter by agent" data-testid="email-log-agent" value={agentId} onChange={e => resetPage(setAgentId, e.target.value)} className={`${inputClass} mt-1`} disabled={agentsQuery.isLoading || !!agentsQuery.error}>
              <option value="">All senders</option>{agentsQuery.isLoading && <option disabled>Loading senders…</option>}<option value="system">System</option>{(agentsQuery.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </NeuSelect>
            {agentsQuery.error && <span role="status" className="mt-1 block text-[9px] font-normal normal-case text-[#8a3028]">Sender list unavailable; retry the page to reload.</span>}
          </label>
          <label className="text-[10px] font-bold uppercase tracking-wide text-[#555] sm:col-span-2">Recipient or subject
            <span className="relative mt-1 block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#666]" />
            <Input aria-label="Search recipient or subject" data-testid="email-log-search" value={search} onChange={e => resetPage(setSearch, e.target.value)} placeholder="Type an address or subject…" className={`${inputClass} pl-8`} />
            </span>
          </label>
        </div>

        {actionMessage && <NeuNotice severity={actionTone === "error" ? "block" : actionTone === "warning" ? "ack" : "info"} role={actionTone === "success" ? "status" : "alert"} data-testid="email-log-action-message" data-tone={actionTone} className="text-xs"><span className="flex items-start gap-2">{actionTone !== "success" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}{actionMessage}</span></NeuNotice>}
        <div className="min-h-[280px]">
          {loading ? (
            <div data-testid="email-log-loading" className="space-y-2 p-4" aria-label="Loading email log">
              {[0, 1, 2, 3].map(item => <div key={item} className="grid grid-cols-6 gap-3 border-b border-[#d1cec6] py-3"><div className="h-3 animate-pulse bg-[#d4d0c8]" /><div className="col-span-2 h-3 animate-pulse bg-[#e2dfd7]" /><div className="h-3 animate-pulse bg-[#d4d0c8]" /><div className="col-span-2 h-3 animate-pulse bg-[#e2dfd7]" /></div>)}
            </div>
          ) : listQuery.error ? (
            <NeuNotice severity="block" role="alert" className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
              <AlertTriangle className="h-7 w-7 text-[#a54135]" />
              <p className="text-sm font-bold text-[#333]">Email history could not be loaded</p>
              <p className="max-w-lg text-xs text-[#666]">{(listQuery.error as Error).message || "The service is temporarily unavailable."}</p>
              <NeuButton className="min-h-9 px-3 text-xs" onClick={() => listQuery.refetch()}>Retry</NeuButton>
            </NeuNotice>
          ) : displayRows.length === 0 ? (
            <div data-testid="email-log-empty" className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"><Mail className="h-5 w-5 text-[#168f9b]" /></div>
              <p className="text-sm font-bold text-[#333]">No outbound messages in this view</p>
              <p className="max-w-sm text-xs text-[#666]">Try widening the date range or clearing one of the filters.</p>
            </div>
          ) : (
              <NeuTable data-testid="email-log-table" className="min-w-[1000px] text-xs">
                <NeuTableHeader className="text-[10px] uppercase tracking-wide">
                  <tr>{["Date", "Direction", "To", "Subject", "Entity", "Status", "Sent by"].map(label => <NeuTableHead key={label} className="px-3 py-3 text-[#667274]">{label}</NeuTableHead>)}</tr>
                </NeuTableHeader>
                <NeuTableBody>
                  {displayRows.map(row => {
                    const expanded = expandedId === emailIdKey(row.id);
                    const detail = expanded ? detailQuery.data : null;
                     return <FragmentRow key={row.id}>
                       <NeuTableRow data-testid="email-log-row" data-email-id={emailIdKey(row.id)} aria-expanded={expanded} aria-label={`Email log: ${row.subject}`} tabIndex={0} role="button" onClick={() => toggleExpanded(row.id)} onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleExpanded(row.id); }
                       }} className={`cursor-pointer focus:outline focus:outline-1 focus:outline-[#27aab8] ${expanded ? "bg-[#d7e4e2]" : ""}`}>
                         <NeuTableCell className="px-3 py-3 font-mono text-[10px] tabular-nums">{prettyDate(row.createdAt)}</NeuTableCell>
                         <NeuTableCell className="px-3 py-3"><NeuBadge tone="accent" className="gap-1 px-2 py-1 text-[10px]"><Send className="h-3 w-3" />Outbound</NeuBadge></NeuTableCell>
                         <NeuTableCell className="max-w-[210px] truncate px-3 py-3" title={addressList(row.toAddresses)}>{addressList(row.toAddresses)}</NeuTableCell>
                         <NeuTableCell className="max-w-[260px] px-3 py-3"><span className="flex items-center gap-1.5"><ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} /><span className="truncate font-semibold">{row.subject || "(no subject)"}</span></span></NeuTableCell>
                         <NeuTableCell className="px-3 py-3">{row.entityUrl && row.entityType && row.entityId ? <a href={row.entityUrl} onClick={e => e.stopPropagation()} className="font-semibold text-[#168f9b] hover:text-[#075b63]"><NeuBadge tone="accent">{humanize(row.entityType)} #{row.entityId}</NeuBadge></a> : <span className="text-[#777]">{row.entityType && row.entityId ? `${humanize(row.entityType)} #${row.entityId}` : "—"}</span>}</NeuTableCell>
                         <NeuTableCell className="px-3 py-3"><NeuBadge data-testid={`email-log-status-${row.status}`} tone={row.status === "delivered" ? "accent" : row.status === "bounced" || row.status === "failed" || row.status === "complained" ? "warning" : "neutral"} className={`${row.status === "failed" || row.status === "complained" ? "text-[#ba554d]" : row.status === "bounced" ? "text-[#c77b3e]" : ""} px-2 py-1 text-[10px]`}>{humanize(row.status)}</NeuBadge></NeuTableCell>
                         <NeuTableCell className="px-3 py-3">{row.sentByName || (row.sentByUserId ? "Unknown sender" : "System")}</NeuTableCell>
                       </NeuTableRow>
                       {expanded && <tr data-testid="email-log-detail"><td colSpan={7} className="bg-[#e0e0e0] p-4">
                         {detailQuery.isLoading ? <div className="h-20 animate-pulse rounded-xl bg-[#d2d2d2]" aria-label="Loading message detail" /> : detailQuery.error ? <NeuNotice severity="block" role="alert" className="flex items-center gap-2 text-xs">{(detailQuery.error as Error).message}<NeuButton className="min-h-9 px-3 text-xs" onClick={() => detailQuery.refetch()}>Retry</NeuButton></NeuNotice> : detail ? (
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]">
                             <NeuCard pressed className="p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#ccc] pb-2">
                                <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-[#666]">Message</p><h3 className="mt-1 break-words text-sm font-bold text-[#222]">{detail.subject || "(no subject)"}</h3></div>
                                {isManager && detail.status === "failed" && <div className="flex flex-col items-end gap-1">
                                   <NeuButton data-testid="email-log-resend" className="min-h-9 px-3 text-xs" variant="accent" disabled={!detail.canResend || detail.inProgress || resend.isPending} title={!detail.canResend ? (detail.resendDisabledReason || "This message cannot be safely resent.") : detail.inProgress ? "A resend is already in progress." : undefined} onClick={() => retryResend(detail)}><RefreshCw className="h-3.5 w-3.5" />{resend.isPending ? "Resending…" : "Resend"}</NeuButton>
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
                                   {attachment.s3_key ? <a data-testid="email-log-attachment" href={`/api/email-log/${encodeURIComponent(detail.id)}/attachments/${index}`} className="inline-flex items-center rounded-lg px-3 py-2 font-semibold text-[#168f9b] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#b8b8b8] hover:text-[#075b63]" onClick={e => e.stopPropagation()}><Download className="mr-1 inline h-3 w-3" />{attachment.filename}</a> : <span data-testid="email-log-attachment-unavailable" className="font-semibold text-[#666]">{attachment.filename} — Unavailable</span>}
                                  <span className="text-[10px] text-[#777]">{attachment.size.toLocaleString()} bytes</span>
                                </li>)}</ul>
                              </div>}
                              {detail.error && <p className="mt-3 border border-[#ad6a60] bg-[#f6e2df] p-2 text-xs text-[#812f25]"><strong>Delivery error:</strong> {detail.error}</p>}
                             </NeuCard>
                             <NeuCard pressed className="p-4">
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
                             </NeuCard>
                          </div>
                        ) : null}
                      </td></tr>}
                    </FragmentRow>;
                  })}
                </NeuTableBody>
              </NeuTable>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#c9cece] px-4 py-3">
          <p data-testid="email-log-pagination-label" className="text-[10px] text-[#444]">{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total.toLocaleString()}` : "Showing 0 records"}</p>
          <div className="flex items-center gap-2">
            <NeuButton data-testid="email-log-prev" className="min-h-9 px-3 text-xs" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />Previous</NeuButton>
            <span data-testid="email-log-page" className="min-w-16 text-center font-mono text-[10px] text-[#333]">Page {page} / {pageCount}</span>
            <NeuButton data-testid="email-log-next" className="min-h-9 px-3 text-xs" disabled={page >= pageCount || loading} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="h-3.5 w-3.5" /></NeuButton>
          </div>
        </div>
      </Card>
      <div className="flex items-center gap-1.5 px-1 text-[10px] text-[#747f81]"><ShieldCheck className="h-3 w-3 text-[#168f9b]" />Email records are read-only. Resending, when available, creates a separate log entry.</div>
      {integrationQuery.error && <p role="status" className="text-[10px] text-[#7a4c12]">Delivery integration status could not be checked.</p>}
      <Dialog open={!!resendTarget} onOpenChange={(open) => { if (!resend.isPending && !open) setResendTarget(null); }}>
        <DialogContent data-testid="email-log-resend-confirm-dialog" className="email-neu-dialog max-h-[92dvh] max-w-lg overflow-y-auto p-0">
          <DialogHeader className="border-b border-[#c9cece] px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base text-[#344244]"><AlertTriangle className="h-4 w-4 text-[#c77b3e]" />Confirm resend</DialogTitle>
            <DialogDescription className="text-xs text-[#687577]">This creates a separate email log entry and sends another message. Confirm the recipient and subject before proceeding.</DialogDescription>
          </DialogHeader>
          {resendTarget && <div className="space-y-3 p-5">
            <div className="rounded-xl bg-[#e0e0e0] p-4 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#7b8789]">Subject</p>
              <p className="mt-1 break-words text-sm font-semibold text-[#344244]">{resendTarget.subject || "(no subject)"}</p>
              <p className="mt-3 text-[9px] font-bold uppercase tracking-wider text-[#7b8789]">Recipient</p>
              <p className="mt-1 break-all text-xs text-[#4d5c5e]">{addressList(resendTarget.toAddresses)}</p>
            </div>
            {resend.error && <NeuNotice severity="block" role="alert" className="text-xs">{(resend.error as Error).message}</NeuNotice>}
          </div>}
          <DialogFooter className="border-t border-[#c9cece] px-5 py-3">
            <NeuButton className="min-h-10 px-4 text-xs" disabled={resend.isPending} onClick={() => setResendTarget(null)}>Cancel</NeuButton>
            <NeuButton data-testid="email-log-resend-confirm" variant="accent" className="min-h-10 px-4 text-xs" disabled={!resendTarget?.canResend || resendTarget.inProgress || resend.isPending} onClick={() => { if (resendTarget && isManager && resendTarget.canResend && !resendTarget.inProgress) resend.mutate(emailIdKey(resendTarget.id)); }}>
              <RefreshCw className="h-3.5 w-3.5" />{resend.isPending ? "Resending…" : "Send another email"}
            </NeuButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NeuPageShell>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export default EmailLogPanel;

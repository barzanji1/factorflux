import { Fragment, useState, useMemo } from "react";
import { ServerArrayPagination, SERVER_ARRAY_PAGE_SIZE, useServerArrayPage } from "@/hooks/use-server-array-page";
import { PageInsights } from "@/components/PageInsights";
import {
  RiskPageFrame as PageShell,
  RiskButton as Button,
  RiskCard as Card,
  RiskInput as Input,
  RiskSelectContent as SelectContent,
  RiskSelectTrigger as SelectTrigger,
  RiskStatCard,
  RiskTable,
  RiskBadge,
} from "@/components/risk/risk-controls";
import { CardContent } from "@/components/ui/card";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import "@/components/risk/risk-neu.css";
import {
  ClipboardList,
  Search,
  User,
  FileText,
  DollarSign,
  FileUp,
  Users,
  Banknote,
  Shield,
  Activity,
  RefreshCw,
  Mail,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type AuditEntry = {
  id: number;
  entityType: string;
  entityId: number;
  eventType: string;
  actorType: "user" | "system" | "client";
  actorId?: string | null;
  payloadJson?: Record<string, unknown> | null;
  createdAt: string;
  actorName?: string | null;
};

type UnifiedEntry = {
  id: string;
  kind: "event";
  title: string;
  detail: string;
  entityType: string;
  entityId: number;
  actorName: string | null;
  actorType: string;
  actionType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  icon: React.ElementType;
  color: string;
};

const EVENT_ICON: Record<string, React.ElementType> = {
  invoice: FileText,
  client: Users,
  debtor: Users,
  load: FileUp,
  document: FileUp,
  user: User,
  payout: Banknote,
  vault: Shield,
  payment: DollarSign,
};

// Event-type-specific icon overrides (take precedence over entity-type icons)
const EVENT_TYPE_ICON: Record<string, React.ElementType> = {
  broker_followup_triggered:           Mail,
  broker_followup_updated:             Mail,
  broker_followup_reminder_sent:       Mail,
  broker_followup_delivery_delivered:  Mail,
  broker_followup_delivery_bounced:    Mail,
  broker_followup_delivery_failed:     Mail,
  broker_followup_delivery_spam:       Mail,
  broker_followup_delivery_unsubscribed: Mail,
};

const EVENT_TYPE_COLOR: Record<string, string> = {
  broker_followup_triggered:           "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  broker_followup_updated:             "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  broker_followup_reminder_sent:       "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  broker_followup_delivery_delivered:  "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  broker_followup_delivery_bounced:    "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  broker_followup_delivery_failed:     "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  broker_followup_delivery_spam:       "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
  broker_followup_delivery_unsubscribed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const ENTITY_COLOR: Record<string, string> = {
  invoice: "ff-badge-submitted",
  client: "ff-badge-hold",
  debtor: "ff-badge-hold",
  carrier: "ff-badge-approved",
  broker: "ff-badge-pending",
  load: "ff-badge-pending",
  document: "ff-badge-draft",
  user: "ff-badge-funded",
  payout: "ff-badge-funded",
  vault: "ff-badge-rejected",
};

function formatEventType(et: string) {
  return et.replace(/\./g, " → ").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function isInvoiceStatusEvent(eventType: string) {
  return ["invoice_status_changed", "status_changed", "invoice.status_changed"].includes(eventType);
}

type DetailRow = { label: string; value: unknown };

function firstDetailValue(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function formatDetailValue(value: unknown, label = ""): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && /amount/i.test(label)) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  if (Array.isArray(value)) return value.map(item => formatDetailValue(item)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${formatEventType(key)}: ${formatDetailValue(nested)}`)
      .join(" · ");
  }
  return String(value).replace(/_/g, " ");
}

function detailPresentation(entry: UnifiedEntry): { title: string; rows: DetailRow[] } {
  const metadata = entry.metadata ?? {};
  const invoiceNumber = firstDetailValue(metadata, "invoiceNumber", "invoiceNo", "invoiceId") ?? entry.entityId;

  if (entry.entityType === "document") {
    return {
      title: "Document Upload Details",
      rows: [
        { label: "Invoice #", value: invoiceNumber },
        { label: "Document Type", value: firstDetailValue(metadata, "documentType", "type") },
        { label: "File Name", value: firstDetailValue(metadata, "originalName", "fileName", "filename") },
      ],
    };
  }

  if (entry.entityType === "invoice" && isInvoiceStatusEvent(entry.actionType)) {
    return {
      title: "Status Change Details",
      rows: [
        { label: "Invoice #", value: invoiceNumber },
        { label: "Previous Status", value: firstDetailValue(metadata, "previousStatus", "oldStatus", "from") },
        { label: "New Status", value: firstDetailValue(metadata, "newStatus", "status", "to") },
        { label: "Reason", value: firstDetailValue(metadata, "reason") },
        { label: "Changed By", value: firstDetailValue(metadata, "changedByName", "changedBy") ?? entry.actorName },
      ],
    };
  }

  if (entry.entityType === "invoice" && entry.actionType === "invoice.updated"
      && Object.prototype.hasOwnProperty.call(metadata, "assignedTo")) {
    return {
      title: "Assignment Details",
      rows: [
        { label: "Invoice #", value: invoiceNumber },
        { label: "Assigned To", value: firstDetailValue(metadata, "assignedTo", "assignedToName") ?? "Unassigned" },
        { label: "Changed By", value: entry.actorName },
      ],
    };
  }

  if (entry.entityType === "invoice" && entry.actionType.startsWith("chargeback_")) {
    return {
      title: "Chargeback Details",
      rows: [
        { label: "Invoice #", value: invoiceNumber },
        { label: "Action", value: formatEventType(entry.actionType) },
        { label: "Date", value: firstDetailValue(metadata, "extensionDate", "chargebackDate", "date") },
        { label: "Amount", value: firstDetailValue(metadata, "amount") },
        { label: "Method", value: firstDetailValue(metadata, "method") },
        { label: "Reference #", value: firstDetailValue(metadata, "reference") },
        { label: "Reason", value: firstDetailValue(metadata, "reason") },
      ],
    };
  }

  if (entry.entityType === "carrier" || entry.entityType === "client") {
    return {
      title: "Carrier Change Details",
      rows: [
        { label: "Carrier Name", value: firstDetailValue(metadata, "carrierName", "clientName", "name") },
        { label: "Field Changed", value: firstDetailValue(metadata, "fieldChanged", "field", "fieldName") },
        { label: "Old Value", value: firstDetailValue(metadata, "oldValue", "previousValue", "from") },
        { label: "New Value", value: firstDetailValue(metadata, "newValue", "currentValue", "to") },
      ],
    };
  }

  if (entry.entityType === "broker" || entry.entityType === "debtor") {
    return {
      title: "Broker Change Details",
      rows: [
        { label: "Broker Name", value: firstDetailValue(metadata, "brokerName", "debtorName", "name") },
        { label: "Field Changed", value: firstDetailValue(metadata, "fieldChanged", "field", "fieldName") },
        { label: "Old Value", value: firstDetailValue(metadata, "oldValue", "previousValue", "from") },
        { label: "New Value", value: firstDetailValue(metadata, "newValue", "currentValue", "to") },
      ],
    };
  }

  if (entry.entityType === "user") {
    return {
      title: "User Activity Details",
      rows: [
        { label: "Agent Name", value: firstDetailValue(metadata, "agentName", "userName", "name") ?? entry.actorName },
        { label: "Action", value: formatEventType(entry.actionType) },
        { label: "Affected Account", value: firstDetailValue(metadata, "affectedAccount", "accountName", "targetUserName", "targetEmail") },
      ],
    };
  }

  if (entry.entityType === "payment" || entry.entityType === "payout") {
    return {
      title: "Payment Details",
      rows: [
        { label: "Invoice #", value: invoiceNumber },
        { label: "Amount", value: firstDetailValue(metadata, "amount", "paymentAmount", "appliedAmount") },
        { label: "Payment Method", value: firstDetailValue(metadata, "paymentMethod", "method") },
        { label: "Reference #", value: firstDetailValue(metadata, "referenceNumber", "reference", "transactionId") },
      ],
    };
  }

  const rows = Object.entries(metadata).map(([key, value]) => ({
    label: formatEventType(key),
    value,
  }));
  return {
    title: `${formatEventType(entry.actionType)} Details`,
    rows: rows.length ? rows : [{ label: "Details", value: entry.detail }],
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function actionBadge(action: string): string {
  const normalized = action.toLowerCase();
  if (normalized.includes("delete") || normalized.includes("declin") || normalized.includes("fail") || normalized.includes("bounce")) return "ff-badge-rejected";
  if (normalized.includes("fund") || normalized.includes("approve") || normalized.includes("deliver")) return "ff-badge-funded";
  if (normalized.includes("create") || normalized.includes("trigger") || normalized.includes("upload")) return "ff-badge-submitted";
  if (normalized.includes("update") || normalized.includes("change") || normalized.includes("edit")) return "ff-badge-pending";
  return "ff-badge-draft";
}

function toUnified(events: AuditEntry[]): UnifiedEntry[] {
  const fromEvents: UnifiedEntry[] = events.map(e => ({
    id: `ev-${e.id}`,
    kind: "event",
    title: isInvoiceStatusEvent(e.eventType)
      ? String((e.payloadJson as any)?.label ?? "Invoice Status Changed")
      : e.eventType === "broker_followup_triggered"
      ? `Follow-Up Triggered — ${(e.payloadJson as any)?.invoiceNumber ?? `Invoice #${e.entityId}`}`
      : e.eventType === "broker_followup_updated"
      ? `Follow-Up Updated — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_reminder_sent"
      ? `Reminder Sent — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_delivery_delivered"
      ? `Email Delivered — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_delivery_bounced"
      ? `⚠ Email Bounced — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_delivery_failed"
      ? `⚠ Email Failed — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_delivery_spam"
      ? `⚠ Marked as Spam — Invoice #${e.entityId}`
      : e.eventType === "broker_followup_delivery_unsubscribed"
      ? `Unsubscribed — Invoice #${e.entityId}`
      : formatEventType(e.eventType),
    detail: isInvoiceStatusEvent(e.eventType)
      ? `Invoice #${e.entityId}: ${String((e.payloadJson as any)?.from ?? "new").replace(/_/g, " ")} → ${String((e.payloadJson as any)?.to ?? "unknown").replace(/_/g, " ")}${(e.payloadJson as any)?.reason ? `. Reason: ${(e.payloadJson as any).reason}` : ""}`
      : e.eventType === "broker_followup_triggered"
      ? `${(e.payloadJson as any)?.clientName ?? ""} · ${(e.payloadJson as any)?.triggerType === "auto" ? "Auto-triggered on funding" : "Manually triggered"}`
      : e.eventType.startsWith("broker_followup_delivery_")
      ? `Reminder #${(e.payloadJson as any)?.reminderId ?? "?"} · ${(e.payloadJson as any)?.email ?? ""}`
      : e.eventType === "broker_followup_reminder_sent"
      ? `Step #${(e.payloadJson as any)?.sequenceNumber ?? "?"} · ${(e.payloadJson as any)?.reminderType ?? ""}`
      : e.entityType.charAt(0).toUpperCase() + e.entityType.slice(1) + (e.entityId ? ` #${e.entityId}` : ""),
    entityType: e.entityType,
    entityId: e.entityId,
    actorName: e.actorName ?? e.actorId ?? null,
    actorType: e.actorType,
    actionType: e.eventType,
    metadata: e.payloadJson ?? null,
    createdAt: e.createdAt,
    icon: EVENT_TYPE_ICON[e.eventType] ?? EVENT_ICON[e.entityType] ?? Activity,
    color: EVENT_TYPE_COLOR[e.eventType] ?? ENTITY_COLOR[e.entityType] ?? "bg-slate-100 text-slate-600",
  }));

  return fromEvents.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [filterUser, setFilterUser] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");

  const params = useMemo<Record<string, string>>(() => ({
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(filterEntity !== "all" ? { entityType: filterEntity } : {}),
    ...(filterAction !== "all" ? { action: filterAction } : {}),
    ...(filterUser !== "all" ? { actor: filterUser } : {}),
    ...(dateRange !== "all" ? { days: dateRange === "today" ? "1" : dateRange } : {}),
  }), [search, filterEntity, filterAction, filterUser, dateRange]);
  const filterResetKey = JSON.stringify(params);
  const {
    items: events,
    total: eventTotal,
    filterOptions,
    page,
    pageCount,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isError: eventsError,
    error: eventsErrorValue,
    refetch,
    setPage,
  } = useServerArrayPage<AuditEntry>("/api/audit/events", { resetKey: filterResetKey, params });
  const unified = useMemo(() => toUnified(events), [events]);

  const entityTypes = filterOptions.entities;
  const actionTypes = filterOptions.actions;
  const users = filterOptions.actors;

  const isLoading = eventsLoading;

  async function exportCsv() {
    if (exportLoading) return;
    setExportLoading(true);
    setExportError("");
    try {
      const fetchPage = async (requestedPage: number) => {
        const url = new URL("/api/audit/events", window.location.origin);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        url.searchParams.set("page", String(requestedPage));
        url.searchParams.set("limit", String(SERVER_ARRAY_PAGE_SIZE));
        const response = await fetch(url.toString(), { credentials: "include" });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.message || `Could not export audit events (HTTP ${response.status}).`);
        }
        const pageEvents: unknown = await response.json();
        if (!Array.isArray(pageEvents)) throw new Error("The audit export returned an unexpected response.");
        const totalHeader = response.headers.get("X-Total-Count");
        const countHeader = totalHeader === null ? Number.NaN : Number(totalHeader);
        return {
          items: pageEvents as AuditEntry[],
          total: Number.isFinite(countHeader) && countHeader >= 0 ? countHeader : pageEvents.length,
        };
      };

      const firstPage = await fetchPage(1);
      const allEvents = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / SERVER_ARRAY_PAGE_SIZE);
      for (let requestedPage = 2; requestedPage <= pageCount; requestedPage += 1) {
        const nextPage = await fetchPage(requestedPage);
        allEvents.push(...nextPage.items);
      }
      const exportEntries = toUnified(allEvents);
      const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
      const rows = exportEntries.map(e => {
        const structuredDetails = detailPresentation(e).rows
          .map(row => `${row.label}: ${formatDetailValue(row.value, row.label)}`)
          .join("; ");
        return [
          e.createdAt, formatEventType(e.actionType), e.entityType, e.entityId,
          e.actorName ?? e.actorType, e.detail, structuredDetails,
        ].map(escape).join(",");
      });
      const csv = ["Timestamp,Action,Entity Type,Entity ID,User,Details,Structured Details", ...rows].join("\n");
      const downloadUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `Trucking_Pros_Financial_audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export audit history.");
    } finally {
      setExportLoading(false);
    }
  }

  return (
    <PageShell
      title="Audit Trail"
      subtitle="Complete event history — status changes, entity updates, and system actions"
      group="Risk"
      className="ff-audit-page"
    >
      <PageInsights entity="audit-log" title="Audit activity" />

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Total Events", value: eventTotal },
                { label: "Today · this page", value: unified.filter(e => new Date(e.createdAt).toDateString() === new Date().toDateString()).length },
                { label: "System · this page", value: unified.filter(e => e.actorType === "system").length },
                { label: "Users · this page", value: unified.filter(e => e.actorType === "user").length },
              ].map(s => <RiskStatCard key={s.label} label={s.label} value={s.value} />)}
            </div>

            {/* Main Log */}
            <Card className="ff-table-container ff-audit-surface overflow-hidden border border-slate-200 bg-white dark:border-slate-800">
              <div className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-slate-500" />
                    Event Logs
                    <RiskBadge className="ff-badge ff-badge-draft ml-2">{unified.length} on page</RiskBadge>
                  </h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…" className="h-10 pl-9 w-52" />
                    </div>
                    <Select value={dateRange} onValueChange={setDateRange}>
                      <SelectTrigger className="h-10 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Dates</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="7">Last 7 Days</SelectItem>
                        <SelectItem value="30">Last 30 Days</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={filterEntity} onValueChange={setFilterEntity}>
                      <SelectTrigger className="h-10 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Entities</SelectItem>
                        {entityTypes.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filterAction} onValueChange={setFilterAction}>
                      <SelectTrigger className="h-10 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Actions</SelectItem>
                        {actionTypes.map(t => <SelectItem key={t} value={t}>{formatEventType(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={filterUser} onValueChange={setFilterUser}>
                      <SelectTrigger className="h-10 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map(user => <SelectItem key={user} value={user}>{user}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" onClick={() => void exportCsv()} disabled={exportLoading} className="gap-1.5">
                      <Download className="h-3.5 w-3.5" /> {exportLoading ? "Preparing CSV…" : "Export CSV"}
                    </Button>
                    <Button variant="outline" onClick={() => refetch()} className="gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                  </div>
                  {exportError && <p role="alert" className="mt-2 text-xs text-red-700">{exportError}</p>}
                </div>
              </div>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : eventsError ? (
                  <div role="alert" className="flex flex-col items-center gap-3 py-16 text-sm text-red-700">
                    <span>{eventsErrorValue instanceof Error ? eventsErrorValue.message : "Could not load audit events."}</span>
                    <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
                  </div>
                ) : unified.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <ClipboardList className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{eventTotal > 0 ? "No matching events on this page" : "No events found"}</p>
                    <p className="mt-1 text-sm text-slate-500">{eventTotal > 0 ? "Change pages or clear a filter to check the rest of the audit history." : "Events appear here as actions are performed in the system."}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <RiskTable className="ff-data-table w-full min-w-[980px]">
                      <thead><tr>
                        {["Action", "Entity", "Details", "User", "Timestamp", ""].map((heading, index) => (
                          <th key={`${heading}-${index}`} className={index === 5 ? "w-12" : ""}>{heading}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                      {unified.map(e => {
                        const Icon = e.icon;
                        const isExpanded = expandedId === e.id;
                        const detailView = detailPresentation(e);
                        return (
                          <Fragment key={e.id}>
                            <tr key={e.id}>
                              <td><RiskBadge className={`ff-badge ${actionBadge(e.actionType)}`}><Icon className="h-3 w-3" />{formatEventType(e.actionType)}</RiskBadge></td>
                              <td><RiskBadge className={`ff-badge ${ENTITY_COLOR[e.entityType] ?? "ff-badge-draft"}`}>{e.entityType} #{e.entityId}</RiskBadge></td>
                              <td><p className="font-semibold">{e.title}</p><p className="text-xs text-slate-500">{e.detail}</p></td>
                              <td><span className="flex items-center gap-1 text-xs"><User className="h-3 w-3" />{e.actorName ?? e.actorType}</span></td>
                              <td className="font-mono text-xs tabular-nums"><div>{new Date(e.createdAt).toLocaleString()}</div><div className="text-slate-500">{timeAgo(e.createdAt)}</div></td>
                              <td><Button size="sm" variant="outline" aria-label={`${isExpanded ? "Collapse" : "Expand"} log details`} onClick={() => setExpandedId(isExpanded ? null : e.id)}>{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${e.id}-detail`}><td colSpan={6} className="!bg-[#f0f0f0]">
                                 <Card className="ff-card ff-audit-surface ff-audit-detail risk-neu-pressed p-4">
                                   <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-700">{detailView.title}</p>
                                   <div className="overflow-hidden rounded-xl border-2 border-[#808080] bg-white">
                                     <RiskTable className="w-full text-xs">
                                       <tbody>
                                         {detailView.rows.map(row => (
                                           <tr key={row.label} className="border-b border-slate-200 last:border-b-0">
                                             <th className="w-1/3 bg-[#d4d0c8] px-3 py-2 text-left font-semibold text-slate-600">
                                               {row.label}
                                             </th>
                                             <td className="break-words px-3 py-2 text-slate-900">
                                               {formatDetailValue(row.value, row.label)}
                                             </td>
                                           </tr>
                                         ))}
                                       </tbody>
                                     </RiskTable>
                                   </div>
                                </Card>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                      </tbody>
                    </RiskTable>
                  </div>
                )}
                {!isLoading && !eventsError && (
                  <ServerArrayPagination
                    page={page}
                    pageCount={pageCount}
                    total={eventTotal}
                    onPageChange={setPage}
                    disabled={eventsFetching}
                  />
                )}
              </CardContent>
            </Card>
    </PageShell>
  );
}

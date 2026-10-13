import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PageShell,
  Win95Button as Button,
  Win95Card as Card,
  Win95CardContent as CardContent,
  Win95Input as Input,
  Win95Select as Select,
  Win95SelectContent as SelectContent,
  Win95SelectItem as SelectItem,
  Win95SelectTrigger as SelectTrigger,
  Win95SelectValue as SelectValue,
  Win95StatCard,
} from "@/components/win95";
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

  const { data: events = [], isLoading: eventsLoading, refetch } = useQuery<AuditEntry[]>({
    queryKey: ["/api/audit/events"],
  });
  const unified = useMemo(() => toUnified(events), [events]);

  const filtered = unified.filter(e => {
    if (filterEntity !== "all" && e.entityType !== filterEntity) return false;
    if (filterAction !== "all" && e.actionType !== filterAction) return false;
    if (filterUser !== "all" && (e.actorName ?? e.actorType) !== filterUser) return false;
    if (dateRange !== "all") {
      const age = Date.now() - new Date(e.createdAt).getTime();
      const maxAge = dateRange === "today" ? 86400000 : Number(dateRange) * 86400000;
      if (age > maxAge) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!e.title.toLowerCase().includes(q) && !e.detail.toLowerCase().includes(q) && !(e.actorName?.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const entityTypes = Array.from(new Set(unified.map(e => e.entityType))).sort();
  const actionTypes = Array.from(new Set(unified.map(e => e.actionType))).sort();
  const users = Array.from(new Set(unified.map(e => e.actorName ?? e.actorType))).sort();

  const isLoading = eventsLoading;

  function exportCsv() {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
    const rows = filtered.map(e => {
      const structuredDetails = detailPresentation(e).rows
        .map(row => `${row.label}: ${formatDetailValue(row.value, row.label)}`)
        .join("; ");
      return [
      e.createdAt, formatEventType(e.actionType), e.entityType, e.entityId,
      e.actorName ?? e.actorType, e.detail, structuredDetails,
    ].map(escape).join(",");
    });
    const csv = ["Timestamp,Action,Entity Type,Entity ID,User,Details,Structured Details", ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Trucking_Pros_Financial_audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageShell
      title="Audit Trail"
      subtitle="Complete event history — status changes, entity updates, and system actions"
      group="Risk"
      className="ff-audit-page"
    >

            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Total Events", value: unified.length },
                { label: "Today", value: unified.filter(e => new Date(e.createdAt).toDateString() === new Date().toDateString()).length },
                { label: "System Events", value: unified.filter(e => e.actorType === "system").length },
                { label: "User Actions", value: unified.filter(e => e.actorType === "user").length },
              ].map(s => <Win95StatCard key={s.label} label={s.label} value={s.value} />)}
            </div>

            {/* Main Log */}
            <Card className="ff-table-container ff-audit-surface overflow-hidden border border-slate-200 bg-white dark:border-slate-800">
              <div className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-slate-500" />
                    Event Logs
                    <span className="ff-badge ff-badge-draft ml-2">{filtered.length}</span>
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
                    <Button variant="outline" onClick={exportCsv} className="gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                    <Button variant="outline" onClick={() => refetch()} className="gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                  </div>
                </div>
              </div>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <ClipboardList className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">No events found</p>
                    <p className="mt-1 text-sm text-slate-500">Events appear here as actions are performed in the system.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="ff-data-table w-full min-w-[980px]">
                      <thead><tr>
                        {["Action", "Entity", "Details", "User", "Timestamp", ""].map((heading, index) => (
                          <th key={`${heading}-${index}`} className={index === 5 ? "w-12" : ""}>{heading}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                      {filtered.map(e => {
                        const Icon = e.icon;
                        const isExpanded = expandedId === e.id;
                        const detailView = detailPresentation(e);
                        return (
                          <>
                            <tr key={e.id}>
                              <td><span className={`ff-badge ${actionBadge(e.actionType)}`}><Icon className="h-3 w-3" />{formatEventType(e.actionType)}</span></td>
                              <td><span className={`ff-badge ${ENTITY_COLOR[e.entityType] ?? "ff-badge-draft"}`}>{e.entityType} #{e.entityId}</span></td>
                              <td><p className="font-semibold">{e.title}</p><p className="text-xs text-slate-500">{e.detail}</p></td>
                              <td><span className="flex items-center gap-1 text-xs"><User className="h-3 w-3" />{e.actorName ?? e.actorType}</span></td>
                              <td className="font-mono text-xs tabular-nums"><div>{new Date(e.createdAt).toLocaleString()}</div><div className="text-slate-500">{timeAgo(e.createdAt)}</div></td>
                              <td><Button size="sm" variant="outline" aria-label={`${isExpanded ? "Collapse" : "Expand"} log details`} onClick={() => setExpandedId(isExpanded ? null : e.id)}>{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button></td>
                            </tr>
                            {isExpanded && (
                              <tr key={`${e.id}-detail`}><td colSpan={6} className="!bg-[#f0f0f0]">
                                 <div className="ff-card ff-audit-surface ff-audit-detail p-4">
                                   <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-700">{detailView.title}</p>
                                   <div className="overflow-hidden rounded-xl border-2 border-[#808080] bg-white">
                                     <table className="w-full text-xs">
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
                                     </table>
                                   </div>
                                </div>
                              </td></tr>
                            )}
                          </>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
    </PageShell>
  );
}

import { useState, useMemo, useCallback } from "react";
import type { ElementType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageInsights } from "@/components/PageInsights";
import { SafePaginatedTable } from "@/components/safe-table-pagination";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FFEmpty } from "@/components/ui/ff-empty";
import { FFOnboarding } from "@/components/ui/ff-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Search, AlertTriangle, AlertOctagon, Info, Flame,
  CheckCircle2, FileWarning, DollarSign, CopyX, Inbox,
  HelpCircle, ShieldAlert, SquareCheck, Square,
} from "lucide-react";
import { useSavedViews, type SavedView } from "@/hooks/use-saved-views";

// ── Sticky-state hook ─────────────────────────────────────────────────────────
function useStickyState<T>(key: string, def: T) {
  const [v, setV] = useState<T>(() => {
    try { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : def; } catch { return def; }
  });
  return [v, (val: T) => {
    setV(val);
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
  }] as const;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ExcType     = "short_pay" | "overpay" | "doc_missing" | "credit_limit_exceeded" | "duplicate_invoice" | "unapplied_payment" | "other";
type ExcSeverity = "low" | "medium" | "high" | "critical";
type ExcStatus   = "open" | "under_review" | "resolved" | "waived";
type ExcEntity   = "invoice" | "payment" | "client" | "debtor" | "broker";

type Exception = {
  id: number;
  type: ExcType;
  severity: ExcSeverity;
  entityType: ExcEntity;
  entityId?: number | null;
  entityRef?: string | null;
  title: string;
  description?: string | null;
  status: ExcStatus;
  assignedTo?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolution?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Config ────────────────────────────────────────────────────────────────────
const SEV = {
  low:      { icon: Info,          dot: "bg-slate-400",   text: "text-slate-600 dark:text-slate-400",   row: "border-l-slate-300 dark:border-l-slate-700",  bg: "" },
  medium:   { icon: AlertTriangle, dot: "bg-amber-500",   text: "text-amber-700 dark:text-amber-400",   row: "border-l-amber-400 dark:border-l-amber-600",  bg: "" },
  high:     { icon: AlertOctagon,  dot: "bg-orange-500",  text: "text-orange-700 dark:text-orange-400", row: "border-l-orange-500 dark:border-l-orange-600", bg: "bg-amber-50/30 dark:bg-amber-950/[0.06]" },
  critical: { icon: Flame,         dot: "bg-red-600",     text: "text-red-700 dark:text-red-400",       row: "border-l-red-500 dark:border-l-red-600",       bg: "bg-red-50/40 dark:bg-red-950/[0.08]" },
};

const TYPE_META: Record<ExcType, { label: string; icon: ElementType }> = {
  short_pay:             { label: "Short Pay",          icon: DollarSign  },
  overpay:               { label: "Overpay",            icon: DollarSign  },
  doc_missing:           { label: "Doc Missing",        icon: FileWarning },
  credit_limit_exceeded: { label: "Credit Limit",       icon: ShieldAlert },
  duplicate_invoice:     { label: "Duplicate Invoice",  icon: CopyX       },
  unapplied_payment:     { label: "Unapplied Payment",  icon: Inbox       },
  other:                 { label: "Other",              icon: HelpCircle  },
};

const STATUS_TABS = [
  { id: "all",          label: "All"          },
  { id: "open",         label: "Open"         },
  { id: "under_review", label: "Under Review" },
  { id: "resolved",     label: "Resolved"     },
  { id: "waived",       label: "Waived"       },
] as const;

type STabId = typeof STATUS_TABS[number]["id"];

function ageDays(d: string): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function AgeBadge({ date }: { date: string }) {
  const d = ageDays(date);
  if (d === 0) return <span className="text-[11px] text-slate-400">Today</span>;
  if (d === 1) return <span className="text-[11px] text-slate-500">1d</span>;
  if (d <= 3)  return <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{d}d</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
      <AlertTriangle className="h-3 w-3" />{d}d
    </span>
  );
}

const STATUS_BADGE: Record<ExcStatus, string> = {
  open:         "ff-badge ff-badge-rejected",
  under_review: "ff-badge ff-badge-pending",
  resolved:     "ff-badge ff-badge-paid",
  waived:       "ff-badge ff-badge-draft",
};
const STATUS_LABEL: Record<ExcStatus, string> = {
  open: "Open", under_review: "Under Review", resolved: "Resolved", waived: "Waived",
};

const SEV_BADGE: Record<ExcSeverity, string> = {
  low:      "ff-badge ff-badge-draft",
  medium:   "ff-badge ff-badge-pending",
  high:     "ff-badge ff-badge-overdue",
  critical: "ff-badge ff-badge-rejected",
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Exceptions() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useStickyState<STabId>("ff:exceptions:tab", "all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: "short_pay" as ExcType, severity: "medium" as ExcSeverity,
    entityType: "invoice" as ExcEntity, entityRef: "", title: "", description: "",
  });

  // Resolve dialog
  const [resolveTarget, setResolveTarget] = useState<Exception | null>(null);
  const [resolution, setResolution] = useState("");

  // Data
  const { data: exceptions = [], isLoading } = useQuery<Exception[]>({ queryKey: ["/api/exceptions"] });

  // Saved views
  const { allViews: savedViews } = useSavedViews("exceptions");

  function applyView(view: SavedView) {
    if (view.filters.tab) setActiveTab(view.filters.tab as STabId);
    if (view.filters.severity) setFilterSeverity(view.filters.severity);
    setActiveViewId(view.id);
    setSelected(new Set());
  }

  // ── Counts ───────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: exceptions.length };
    for (const t of STATUS_TABS) {
      if (t.id !== "all") c[t.id] = exceptions.filter(e => e.status === t.id).length;
    }
    return c;
  }, [exceptions]);

  const criticalCount = exceptions.filter(e => e.severity === "critical" && e.status !== "resolved" && e.status !== "waived").length;
  const openCount = exceptions.filter(e => e.status === "open").length;

  // ── Filtered rows ────────────────────────────────────────────────
  const rows = useMemo(() => {
    let items = exceptions;
    if (activeTab !== "all") items = items.filter(e => e.status === activeTab);
    if (filterSeverity !== "all") items = items.filter(e => e.severity === filterSeverity);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.entityRef?.toLowerCase().includes(q) ?? false) ||
        (e.description?.toLowerCase().includes(q) ?? false)
      );
    }
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const statOrder = { open: 0, under_review: 1, resolved: 2, waived: 3 };
    return [...items].sort((a, b) => {
      const ss = (statOrder[a.status] ?? 0) - (statOrder[b.status] ?? 0);
      if (ss !== 0) return ss;
      return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    });
  }, [exceptions, activeTab, filterSeverity, search]);

  // ── Mutations ────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/exceptions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exceptions"] });
      setShowCreate(false);
      setCreateForm({ type: "short_pay", severity: "medium", entityType: "invoice", entityRef: "", title: "", description: "" });
      toast({ title: "Exception created" });
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: { id: number; [k: string]: unknown }) => {
      const { id, ...data } = payload;
      return apiRequest("PATCH", `/api/exceptions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exceptions"] });
      setResolveTarget(null); setResolution("");
      toast({ title: "Exception updated" });
    },
  });

  const bulkUpdate = useCallback((updates: object) => {
    const ids = Array.from(selected);
    Promise.all(ids.map(id => updateMut.mutateAsync({ id, ...updates })))
      .then(() => { toast({ title: `${ids.length} exceptions updated` }); setSelected(new Set()); })
      .catch(() => {});
  }, [selected, updateMut, toast]);

  const toggleAll = () =>
    setSelected(selected.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map(e => e.id)));
  const toggleRow = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Exceptions" subtitle="Track and resolve short-pays, overpays, missing docs, and workflow holds" group="Risk" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] space-y-4 p-6 xl:p-8">
            <PageInsights entity="exceptions" title="Exception workload" />

            {/* ── Critical nudge banner ───────────────────────────────────── */}
            {criticalCount > 0 && (
              <div className="flex items-center gap-3 rounded-[12px] border border-red-200/60 bg-red-50/50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/10">
                <Flame className="h-4 w-4 shrink-0 text-red-500" />
                <p className="text-[12.5px] font-medium text-red-800 dark:text-red-300">
                  <span className="font-bold">{criticalCount} critical exception{criticalCount !== 1 ? "s" : ""}</span> require immediate attention
                  {openCount > criticalCount && (
                    <span className="ml-1 text-red-600/70">· {openCount - criticalCount} other open</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => { setActiveTab("open"); setFilterSeverity("critical"); setActiveViewId("open_critical"); }}
                  className="ml-auto whitespace-nowrap text-[11.5px] font-semibold text-red-600 hover:text-red-700 dark:text-red-400"
                >
                  View critical →
                </button>
              </div>
            )}

            {/* ── Summary strip ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: "Open",         value: counts.open ?? 0,         warn: (counts.open ?? 0) > 0       },
                { label: "Critical",     value: criticalCount,             warn: criticalCount > 0            },
                { label: "Under Review", value: counts.under_review ?? 0, warn: false                        },
                { label: "Resolved",     value: counts.resolved ?? 0,     positive: true                     },
                { label: "Waived",       value: counts.waived ?? 0,       positive: false                    },
              ].map(s => (
                <div key={s.label} className="rounded-[12px] border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
                  <p className={cn(
                    "mt-0.5 text-[22px] font-bold tracking-tight",
                    (s as any).warn ? "text-red-600 dark:text-red-400"
                    : (s as any).positive ? "text-emerald-600 dark:text-emerald-400"
                    : "text-slate-900 dark:text-white"
                  )}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* ── Queue card ─────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">

              {/* Sticky filter bar */}
              <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-[hsl(var(--card))/95]">

                {/* Saved view pills */}
                <div className="flex items-center gap-1.5 px-5 pt-3 pb-1.5">
                  <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600">Views</span>
                  {savedViews.map(view => (
                    <button
                      key={view.id}
                      type="button"
                      onClick={() => applyView(view)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                        activeViewId === view.id
                          ? "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400"
                      )}
                    >
                      <span>{view.emoji}</span> {view.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-3 px-5 py-2.5 lg:flex-row lg:items-center lg:justify-between">
                  {/* Status tabs */}
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_TABS.map(tab => {
                      const count = counts[tab.id] ?? 0;
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setActiveTab(tab.id); setSelected(new Set()); setActiveViewId(null); }}
                          className={cn(
                            "rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors",
                            isActive
                              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400",
                            tab.id === "open" && !isActive && count > 0 && "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400"
                          )}
                        >
                          {tab.label} <span className="opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Filters + create */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-8 w-[180px] rounded-full pl-9 text-[12px]" />
                    </div>
                    <Select value={filterSeverity} onValueChange={v => { setFilterSeverity(v); setActiveViewId(null); }}>
                      <SelectTrigger className="h-8 w-[130px] rounded-full text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All severities</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => setShowCreate(true)}
                      className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-blue-700"
                    >
                      <Plus className="h-3 w-3" /> New
                    </button>
                  </div>
                </div>

                {/* Bulk bar */}
                {selected.size > 0 && (
                  <div className="flex items-center gap-3 border-t border-blue-100 bg-blue-50/60 px-5 py-2 dark:border-blue-900/30 dark:bg-blue-950/10">
                    <span className="text-[12px] font-semibold text-blue-700 dark:text-blue-300">{selected.size} selected</span>
                    <div className="h-3.5 w-px bg-blue-200 dark:bg-blue-800" />
                    <button
                      type="button"
                      onClick={() => bulkUpdate({ status: "under_review" })}
                      disabled={updateMut.isPending}
                      className="rounded-md bg-amber-500 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Mark Under Review
                    </button>
                    <button
                      type="button"
                      onClick={() => { setResolution(""); setResolveTarget(rows.find(r => selected.has(r.id)) ?? null); }}
                      disabled={updateMut.isPending}
                      className="rounded-md bg-emerald-600 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Resolve All
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkUpdate({ status: "waived" })}
                      disabled={updateMut.isPending}
                      className="rounded-md bg-slate-600 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      Waive All
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[11.5px] font-medium text-blue-500 hover:text-blue-700">
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Table / Empty */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-8 py-10">
                  {exceptions.length === 0 ? (
                    <FFOnboarding
                      title="Queue is clean"
                      description="No exceptions logged. Exceptions auto-create when the system detects issues, or you can log one manually."
                      icon={CheckCircle2}
                      steps={[
                        { label: "Review new invoices for short-pays or overcharges", detail: "System flags automatically when amounts mismatch" },
                        { label: "Check for unapplied payments in Cash Application" },
                        { label: "Monitor missing docs in the Factoring queue" },
                      ]}
                      primaryAction={{ label: "Log Exception", onClick: () => setShowCreate(true) }}
                      hint="Tip: Critical exceptions block funding until resolved — check your queue daily."
                    />
                  ) : (
                    <div className="py-8 text-center">
                      <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">No exceptions match these filters</p>
                      <p className="mt-1 text-sm text-slate-400">Try a different filter or clear your search.</p>
                      <button
                        type="button"
                        onClick={() => { setActiveTab("all"); setFilterSeverity("all"); setSearch(""); setActiveViewId(null); }}
                        className="mt-3 text-[12px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Clear all filters
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <SafePaginatedTable>
                  <table className="ff-data-table w-full min-w-[820px]">
                    <thead>
                      <tr>
                        <th className="w-9 pl-5">
                          <button type="button" onClick={toggleAll} className="text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300">
                            {selected.size > 0 && selected.size === rows.length
                              ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" />
                              : <Square className="h-3.5 w-3.5" />}
                          </button>
                        </th>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Ref</th>
                        <th>Severity</th>
                        <th>Age</th>
                        <th>Status</th>
                        <th>Owner</th>
                        <th className="pr-5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(exc => {
                        const sev = SEV[exc.severity];
                        const TypeMeta = TYPE_META[exc.type];
                        const TypeIcon = TypeMeta.icon;
                        const isSel = selected.has(exc.id);
                        const isActive = exc.status !== "resolved" && exc.status !== "waived";
                        return (
                          <tr
                            key={exc.id}
                            className={cn(
                              "border-l-[3px]",
                              sev.row,
                              isActive && sev.bg,
                              isSel && "!bg-blue-50/50 dark:!bg-blue-950/10"
                            )}
                          >
                            <td className="pl-5">
                              <button type="button" onClick={() => toggleRow(exc.id)} className="text-slate-400 hover:text-blue-600">
                                {isSel ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" /> : <Square className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                            <td>
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-900 dark:text-white">{exc.title}</span>
                                {exc.description && (
                                  <span className="mt-0.5 max-w-[240px] truncate text-[10.5px] text-slate-400">{exc.description}</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400">
                                <TypeIcon className="h-3 w-3" />
                                {TypeMeta.label}
                              </span>
                            </td>
                            <td className="font-mono text-[11.5px] text-slate-500 dark:text-slate-400">
                              {exc.entityRef ?? <span className="text-slate-300 dark:text-slate-600">—</span>}
                            </td>
                            <td>
                              <span className={SEV_BADGE[exc.severity]}>{exc.severity}</span>
                            </td>
                            <td><AgeBadge date={exc.createdAt} /></td>
                            <td>
                              <span className={STATUS_BADGE[exc.status]}>{STATUS_LABEL[exc.status]}</span>
                            </td>
                            <td className="text-[11.5px] text-slate-500 dark:text-slate-400">
                              {exc.assignedTo
                                ? <span className="font-medium">{exc.assignedTo}</span>
                                : <span className="text-slate-300 dark:text-slate-600">—</span>}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {exc.status === "open" && (
                                  <button
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: exc.id, status: "under_review" })}
                                    disabled={updateMut.isPending}
                                    className="rounded-[7px] bg-amber-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                                  >
                                    Review
                                  </button>
                                )}
                                {(exc.status === "open" || exc.status === "under_review") && (
                                  <button
                                    type="button"
                                    onClick={() => { setResolveTarget(exc); setResolution(""); }}
                                    className="rounded-[7px] bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                                  >
                                    Resolve
                                  </button>
                                )}
                                {(exc.status === "open" || exc.status === "under_review") && (
                                  <button
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: exc.id, status: "waived" })}
                                    disabled={updateMut.isPending}
                                    className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                                  >
                                    Waive
                                  </button>
                                )}
                                {exc.resolution && (
                                  <span className="max-w-[120px] truncate text-[10.5px] italic text-emerald-600 dark:text-emerald-400">
                                    ✓ {exc.resolution}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </SafePaginatedTable>
              )}

              {rows.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                  <span className="text-[11.5px] text-slate-400">{rows.length} items</span>
                  {criticalCount > 0 && (
                    <span className="text-[11.5px] font-semibold text-red-600 dark:text-red-400">
                      {criticalCount} critical
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── Create dialog ─────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle>Create Exception</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[12px] font-semibold">Title</Label>
              <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} placeholder="Brief description of the exception" className="mt-1 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-semibold">Type</Label>
                <Select value={createForm.type} onValueChange={v => setCreateForm(f => ({ ...f, type: v as ExcType }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px] font-semibold">Severity</Label>
                <Select value={createForm.severity} onValueChange={v => setCreateForm(f => ({ ...f, severity: v as ExcSeverity }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-semibold">Entity Type</Label>
                <Select value={createForm.entityType} onValueChange={v => setCreateForm(f => ({ ...f, entityType: v as ExcEntity }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="debtor">Debtor</SelectItem>
                    <SelectItem value="broker">Broker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px] font-semibold">Reference</Label>
                <Input value={createForm.entityRef} onChange={e => setCreateForm(f => ({ ...f, entityRef: e.target.value }))} placeholder="Invoice#, ref…" className="mt-1 rounded-xl" />
              </div>
            </div>
            <div>
              <Label className="text-[12px] font-semibold">Description</Label>
              <Textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the exception…" className="mt-1 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => createMut.mutate({ ...createForm, entityRef: createForm.entityRef || null, description: createForm.description || null })}
              disabled={!createForm.title.trim() || createMut.isPending}
              className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"
            >
              {createMut.isPending ? "Saving…" : "Create Exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resolve dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!resolveTarget} onOpenChange={o => !o && setResolveTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Resolve Exception</DialogTitle></DialogHeader>
          {resolveTarget && (
            <p className="text-sm text-slate-600 dark:text-slate-400">{resolveTarget.title}</p>
          )}
          {selected.size > 1 && resolveTarget && (
            <p className="text-[12px] text-amber-600">Resolving {selected.size} selected exceptions</p>
          )}
          <div>
            <Label className="text-[12px] font-semibold">Resolution Notes</Label>
            <Textarea value={resolution} onChange={e => setResolution(e.target.value)} rows={4} placeholder="Describe how this was resolved…" className="mt-1 rounded-xl" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)} className="rounded-xl">Cancel</Button>
            <Button
              onClick={() => {
                if (selected.size > 1 && resolveTarget) {
                  bulkUpdate({ status: "resolved", resolution });
                  setResolveTarget(null);
                } else if (resolveTarget) {
                  updateMut.mutate({ id: resolveTarget.id, status: "resolved", resolution });
                }
              }}
              disabled={!resolution.trim() || updateMut.isPending}
              className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {updateMut.isPending ? "Resolving…" : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

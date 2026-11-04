import { useState, useMemo, useCallback } from "react";
import type { ElementType } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageInsights } from "@/components/PageInsights";
import { NeuTable } from "@/styles/neu/components";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FFEmpty } from "@/components/ui/ff-empty";
import { FFOnboarding } from "@/components/ui/ff-onboarding";
import { Button, Input, Textarea, Card, DialogContent, SelectContent, SelectTrigger, AdminPageShell, Badge as NeuBadge } from "@/components/admin-neu/adapters";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectItem, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Search, AlertTriangle, AlertOctagon, Info, Flame,
  CheckCircle2, FileWarning, DollarSign, CopyX, Inbox,
  HelpCircle, ShieldAlert, SquareCheck, Square,
} from "lucide-react";
import { useSavedViews, type SavedView } from "@/hooks/use-saved-views";
import "@/components/admin-neu/admin-neu-page.css";

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
  if (d === 0) return <span className="text-[11px] text-[#777]">Today</span>;
  if (d === 1) return <span className="text-[11px] text-[#666]">1d</span>;
  if (d <= 3)  return <span className="text-[11px] font-semibold text-[#9b6a22]">{d}d</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#a3483e]">
      <AlertTriangle className="h-3 w-3" />{d}d
    </span>
  );
}

const STATUS_LABEL: Record<ExcStatus, string> = {
  open: "Open", under_review: "Under Review", resolved: "Resolved", waived: "Waived",
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
    <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Exceptions" subtitle="Track and resolve short-pays, overpays, missing docs, and workflow holds" group="Risk" />
        <AdminPageShell className="custom-scrollbar flex-1 overflow-auto !min-h-0">
          <div className="mx-auto w-full max-w-[1680px] space-y-4 p-6 xl:p-8">
            <PageInsights entity="exceptions" title="Exception workload" />

            {/* ── Critical nudge banner ───────────────────────────────────── */}
            {criticalCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-[#f0dfdc] px-4 py-3 text-[#812f25] shadow-[inset_4px_4px_8px_#c8aaa7,inset_-4px_-4px_8px_#fff]">
                <Flame className="h-4 w-4 shrink-0 text-[#a3483e]" />
                <p className="text-[12.5px] font-medium">
                  <span className="font-bold">{criticalCount} critical exception{criticalCount !== 1 ? "s" : ""}</span> require immediate attention
                  {openCount > criticalCount && (
                    <span className="ml-1 text-[#a3483e]">· {openCount - criticalCount} other open</span>
                  )}
                </p>
                <Button
                  type="button"
                  onClick={() => { setActiveTab("open"); setFilterSeverity("critical"); setActiveViewId("open_critical"); }}
                  variant="ghost"
                  className="ml-auto whitespace-nowrap text-[11.5px] font-semibold text-[#a3483e]"
                >
                  View critical →
                </Button>
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
                <Card key={s.label} className="rounded-2xl p-4">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#777]">{s.label}</p>
                  <p className={cn(
                    "mt-0.5 text-[22px] font-bold tracking-tight",
                    (s as any).warn ? "text-[#a3483e]"
                    : (s as any).positive ? "text-[#168d99]"
                    : "text-[#333]"
                  )}>{s.value}</p>
                </Card>
              ))}
            </div>

            {/* ── Queue card ─────────────────────────────────────────────── */}
            <Card className="overflow-hidden rounded-2xl">

              {/* Sticky filter bar */}
              <div className="sticky top-0 z-10 border-b border-[#c9c9c9] bg-[#e0e0e0]">

                {/* Saved view pills */}
                <div className="flex items-center gap-1.5 px-5 pt-3 pb-1.5">
                  <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wide text-[#777]">Views</span>
                  {savedViews.map(view => (
                    <Button
                      key={view.id}
                      type="button"
                      onClick={() => applyView(view)}
                      variant={activeViewId === view.id ? "accent" : "ghost"}
                      size="sm"
                      className="flex h-7 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]"
                    >
                      <span>{view.emoji}</span> {view.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-col gap-3 px-5 py-2.5 lg:flex-row lg:items-center lg:justify-between">
                  {/* Status tabs */}
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_TABS.map(tab => {
                      const count = counts[tab.id] ?? 0;
                      const isActive = activeTab === tab.id;
                      return (
                        <Button
                          key={tab.id}
                          type="button"
                          onClick={() => { setActiveTab(tab.id); setSelected(new Set()); setActiveViewId(null); }}
                          variant={isActive ? "accent" : "ghost"}
                          size="sm"
                          className={cn("rounded-full px-3 py-1 text-[11.5px]", tab.id === "open" && !isActive && count > 0 && "text-[#a3483e]")}
                        >
                          {tab.label} <span className="opacity-60">{count}</span>
                        </Button>
                      );
                    })}
                  </div>

                  {/* Filters + create */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888]" />
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
                      <Button
                      type="button"
                      onClick={() => setShowCreate(true)}
                        variant="accent"
                        size="sm"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px]"
                    >
                      <Plus className="h-3 w-3" /> New
                      </Button>
                  </div>
                </div>

                {/* Bulk bar */}
                {selected.size > 0 && (
                  <div className="flex items-center gap-3 border-t border-[#c9c9c9] bg-[#dceaea] px-5 py-2">
                    <span className="text-[12px] font-semibold text-[#168d99]">{selected.size} selected</span>
                    <div className="h-3.5 w-px bg-[#adcaca]" />
                    <Button
                      type="button"
                      onClick={() => bulkUpdate({ status: "under_review" })}
                      disabled={updateMut.isPending}
                      variant="outline"
                      size="sm"
                      className="px-3 py-1 text-[11.5px] text-[#9b6a22]"
                    >
                      Mark Under Review
                    </Button>
                    <Button
                      type="button"
                      onClick={() => { setResolution(""); setResolveTarget(rows.find(r => selected.has(r.id)) ?? null); }}
                      disabled={updateMut.isPending}
                      variant="accent"
                      size="sm"
                      className="px-3 py-1 text-[11.5px]"
                    >
                      Resolve All
                    </Button>
                    <Button
                      type="button"
                      onClick={() => bulkUpdate({ status: "waived" })}
                      disabled={updateMut.isPending}
                      variant="outline"
                      size="sm"
                      className="px-3 py-1 text-[11.5px]"
                    >
                      Waive All
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="ml-auto text-[11.5px] font-medium text-[#168d99]">
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              {/* Table / Empty */}
              {isLoading ? (
                <div className="space-y-3 p-5" aria-label="Loading exceptions">
                  {[0, 1, 2].map((row) => <div key={row} className="h-12 animate-pulse rounded-xl bg-[#d2d2d2]" />)}
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
                      <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[#168d99]" />
                      <p className="text-sm font-semibold text-[#333]">No exceptions match these filters</p>
                      <p className="mt-1 text-sm text-[#777]">Try a different filter or clear your search.</p>
                      <Button
                        type="button"
                        onClick={() => { setActiveTab("all"); setFilterSeverity("all"); setSearch(""); setActiveViewId(null); }}
                        variant="ghost"
                        className="mt-3 text-[12px] font-semibold text-[#168d99]"
                      >
                        Clear all filters
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <NeuTable className="w-full min-w-[820px]">
                    <thead>
                      <tr>
                        <th className="w-9 pl-5">
                          <Button type="button" variant="ghost" size="icon" onClick={toggleAll} className="h-7 w-7 text-[#777]">
                            {selected.size > 0 && selected.size === rows.length
                              ? <SquareCheck className="h-3.5 w-3.5 text-[#168d99]" />
                              : <Square className="h-3.5 w-3.5" />}
                          </Button>
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
                        const TypeMeta = TYPE_META[exc.type];
                        const TypeIcon = TypeMeta.icon;
                        const isSel = selected.has(exc.id);
                        return (
                          <tr
                            key={exc.id}
                            className={cn("transition-colors hover:bg-[#dceaea]", isSel && "bg-[#d7eaea]")}
                          >
                            <td className="pl-5">
                              <Button type="button" variant="ghost" size="icon" onClick={() => toggleRow(exc.id)} className="h-7 w-7 text-[#777]">
                                {isSel ? <SquareCheck className="h-3.5 w-3.5 text-[#168d99]" /> : <Square className="h-3.5 w-3.5" />}
                              </Button>
                            </td>
                            <td>
                              <div className="flex flex-col">
                                <span className="font-medium text-[#333]">{exc.title}</span>
                                {exc.description && (
                                  <span className="mt-0.5 max-w-[240px] truncate text-[10.5px] text-[#777]">{exc.description}</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-[11.5px] text-[#666]">
                                <TypeIcon className="h-3 w-3" />
                                {TypeMeta.label}
                              </span>
                            </td>
                            <td className="font-mono text-[11.5px] text-[#666]">
                              {exc.entityRef ?? <span className="text-[#999]">—</span>}
                            </td>
                            <td>
                              <NeuBadge tone={exc.severity === "critical" || exc.severity === "high" ? "warning" : "neutral"}>{exc.severity}</NeuBadge>
                            </td>
                            <td><AgeBadge date={exc.createdAt} /></td>
                            <td>
                              <NeuBadge tone={exc.status === "resolved" ? "success" : exc.status === "under_review" ? "accent" : exc.status === "open" ? "warning" : "neutral"}>{STATUS_LABEL[exc.status]}</NeuBadge>
                            </td>
                            <td className="text-[11.5px] text-[#666]">
                              {exc.assignedTo
                                ? <span className="font-medium">{exc.assignedTo}</span>
                                : <span className="text-[#999]">—</span>}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {exc.status === "open" && (
                                  <Button
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: exc.id, status: "under_review" })}
                                    disabled={updateMut.isPending}
                                    variant="outline"
                                    size="sm"
                                    className="px-2.5 py-1.5 text-[11px] text-[#9b6a22]"
                                  >
                                    Review
                                  </Button>
                                )}
                                {(exc.status === "open" || exc.status === "under_review") && (
                                  <Button
                                    type="button"
                                    onClick={() => { setResolveTarget(exc); setResolution(""); }}
                                    variant="accent"
                                    size="sm"
                                    className="px-2.5 py-1.5 text-[11px]"
                                  >
                                    Resolve
                                  </Button>
                                )}
                                {(exc.status === "open" || exc.status === "under_review") && (
                                  <Button
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: exc.id, status: "waived" })}
                                    disabled={updateMut.isPending}
                                    variant="outline"
                                    size="sm"
                                    className="px-2 py-1 text-[11px]"
                                  >
                                    Waive
                                  </Button>
                                )}
                                {exc.resolution && (
                                  <span className="max-w-[120px] truncate text-[10.5px] italic text-[#168d99]">
                                    ✓ {exc.resolution}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                </NeuTable>
              )}

              {rows.length > 0 && (
                <div className="flex items-center justify-between border-t border-[#c9c9c9] px-5 py-2.5">
                  <span className="text-[11.5px] text-[#777]">{rows.length} items</span>
                  {criticalCount > 0 && (
                    <span className="text-[11.5px] font-semibold text-[#a3483e]">
                      {criticalCount} critical
                    </span>
                  )}
                </div>
              )}
            </Card>
          </div>
        </AdminPageShell>
      </div>

      {/* ── Create dialog ─────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8]">
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
              variant="accent"
            >
              {createMut.isPending ? "Saving…" : "Create Exception"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resolve dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!resolveTarget} onOpenChange={o => !o && setResolveTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8]">
          <DialogHeader><DialogTitle>Resolve Exception</DialogTitle></DialogHeader>
          {resolveTarget && (
            <p className="text-sm text-[#555]">{resolveTarget.title}</p>
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
              variant="accent"
            >
              {updateMut.isPending ? "Resolving…" : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

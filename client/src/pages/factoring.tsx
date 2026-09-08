import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FFBadge } from "@/components/ui/ff-badge";
import { FFEmpty } from "@/components/ui/ff-empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Invoice } from "@shared/schema";
import { Search, Eye, AlertTriangle, SquareCheck, Square, ChevronRight } from "lucide-react";

// ── Sticky-state hook (persists tab across navigations) ───────────────────────
function useStickyState<T>(key: string, def: T) {
  const [v, setV] = useState<T>(() => {
    try { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : def; } catch { return def; }
  });
  return [v, (val: T) => {
    setV(val);
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
  }] as const;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: string | number) =>
  `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ageDays(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function AgeBadge({ date }: { date: string | Date | null | undefined }) {
  const d = ageDays(date);
  if (d === null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  if (d === 0)   return <span className="text-[11px] text-slate-400 dark:text-slate-500">Today</span>;
  if (d === 1)   return <span className="text-[11px] text-slate-500 dark:text-slate-400">1d</span>;
  if (d <= 2)    return <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{d}d</span>;
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
      <AlertTriangle className="h-3 w-3" />{d}d
    </span>
  );
}

// ── Queue tab config ──────────────────────────────────────────────────────────
const QUEUE_TABS = [
  { id: "all",          label: "All",           statuses: null,                             dot: "bg-slate-400" },
  { id: "new",          label: "New",            statuses: ["submitted"],                   dot: "bg-blue-500" },
  { id: "docs_pending", label: "Docs Pending",   statuses: ["docs_pending"],                dot: "bg-amber-500" },
  { id: "under_review", label: "Under Review",   statuses: ["under_review"],                dot: "bg-violet-500" },
  { id: "approved",     label: "Approved",       statuses: ["approved"],                    dot: "bg-emerald-500" },
  { id: "funded",       label: "Funded",         statuses: ["funded", "settled", "paid"],   dot: "bg-emerald-600" },
  { id: "chargebacks",   label: "Chargebacks",    statuses: null,                             dot: "bg-orange-600" },
  { id: "held",         label: "Held",           statuses: ["rejected"],                    dot: "bg-red-500" },
] as const;

type QTabId = typeof QUEUE_TABS[number]["id"];
type TransId = "request_docs" | "start_review" | "approve" | "reject" | "fund";

type RowAction = { label: string; tid: TransId; needsReason?: boolean; danger?: boolean };

const ROW_ACTIONS: Record<QTabId, RowAction[]> = {
  all:          [],
  new:          [
    { label: "Start Review", tid: "start_review" },
    { label: "Req. Docs",    tid: "request_docs", needsReason: true },
  ],
  docs_pending: [{ label: "Begin Review", tid: "start_review" }],
  under_review: [
    { label: "Approve", tid: "approve" },
    { label: "Reject",  tid: "reject",  needsReason: true, danger: true },
  ],
  approved: [{ label: "Fund", tid: "fund" }],
  funded:   [],
  chargebacks: [],
  held:     [],
};

const BULK_ACTIONS: Record<QTabId, Array<{ label: string; tid: TransId; needsReason?: boolean }>> = {
  all:          [],
  new:          [{ label: "Move to Review", tid: "start_review" }],
  docs_pending: [{ label: "Begin Review",   tid: "start_review" }],
  under_review: [
    { label: "Approve All", tid: "approve" },
    { label: "Reject All",  tid: "reject",  needsReason: true },
  ],
  approved: [{ label: "Fund All", tid: "fund" }],
  funded:   [],
  chargebacks: [],
  held:     [],
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Factoring() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, go] = useLocation();

  const [activeTab, setActiveTab] = useStickyState<QTabId>("ff:factoring:tab", "all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reasonDlg, setReasonDlg] = useState<{ tid: TransId; invoice?: Invoice; bulk?: boolean } | null>(null);
  const [reason, setReason] = useState("");

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  type AgingAlert = { id: number; invoiceId: number; invoiceNumber: string; carrier: string | null; broker: string | null; fundedAt: string; alertType: "day_60" | "day_90"; status: string };
  const [agingView, setAgingView] = useState<"pending" | "resolved">("pending");
  const { data: agingAlerts = [] } = useQuery<AgingAlert[]>({ queryKey: ["/api/invoices/aging-alerts", agingView], queryFn: () => fetch(`/api/invoices/aging-alerts?view=${agingView}`, { credentials: "include" }).then(r => r.json()) });
  const acknowledgeAging = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoices/aging-alerts/${id}/acknowledge`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/invoices/aging-alerts"] }); toast({ title: "Aging alert acknowledged" }); },
    onError: () => toast({ title: "Unable to acknowledge alert", variant: "destructive" }),
  });

  // ── Derived counts ───────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: invoices.length };
    for (const t of QUEUE_TABS) {
      if (t.id === "chargebacks") c[t.id] = invoices.filter(i => ["scheduled", "extended", "charged"].includes((i as any).chargebackStatus)).length;
      else if (t.statuses) c[t.id] = invoices.filter(i => (t.statuses as readonly string[]).includes(i.status)).length;
    }
    return c;
  }, [invoices]);

  const pipelineItems = invoices.filter(i => !["funded", "settled", "paid", "rejected"].includes(i.status));
  const pipelineAmount = pipelineItems.reduce((s, i) => s + Number(i.amount ?? 0), 0);

  // ── Visible rows ─────────────────────────────────────────────────
  const rows = useMemo(() => {
    const tab = QUEUE_TABS.find(t => t.id === activeTab)!;
    let items = activeTab === "chargebacks"
      ? invoices.filter(i => ["scheduled", "extended", "charged"].includes((i as any).chargebackStatus))
      : tab.statuses
      ? invoices.filter(i => (tab.statuses as readonly string[]).includes(i.status))
      : invoices;
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.invoiceNumber?.toLowerCase().includes(q) ||
        i.loadNumber?.toLowerCase().includes(q) ||
        String(i.loadId ?? "").includes(q)
      );
    }
    return [...items].sort((a, b) =>
      new Date(a.submittedAt ?? 0).getTime() - new Date(b.submittedAt ?? 0).getTime()
    );
  }, [invoices, activeTab, search]);

  // ── Mutation ─────────────────────────────────────────────────────
  const doTransition = useMutation({
    mutationFn: async ({ id, tid, reason }: { id: number; tid: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${id}/transition`, {
        transitionId: tid, reason: reason ?? undefined, force: false,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Transition failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setSelected(new Set());
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const handleRow = useCallback((inv: Invoice, action: RowAction) => {
    if (action.needsReason) { setReason(""); setReasonDlg({ tid: action.tid, invoice: inv }); }
    else doTransition.mutate({ id: inv.id, tid: action.tid });
  }, [doTransition]);

  const handleBulk = useCallback((ba: typeof BULK_ACTIONS[QTabId][number]) => {
    if (selected.size === 0) return;
    if (ba.needsReason) { setReason(""); setReasonDlg({ tid: ba.tid, bulk: true }); }
    else {
      Promise.all(Array.from(selected).map(id => doTransition.mutateAsync({ id, tid: ba.tid })))
        .then(() => toast({ title: `${selected.size} invoices updated` })).catch(() => {});
    }
  }, [selected, doTransition, toast]);

  const confirmReason = useCallback(() => {
    if (!reasonDlg || !reason.trim()) return;
    const ids = reasonDlg.bulk ? Array.from(selected) : [reasonDlg.invoice!.id];
    Promise.all(ids.map(id => doTransition.mutateAsync({ id, tid: reasonDlg.tid, reason })))
      .then(() => { toast({ title: `${ids.length} invoice${ids.length > 1 ? "s" : ""} updated` }); setReasonDlg(null); })
      .catch(() => {});
  }, [reasonDlg, reason, selected, doTransition, toast]);

  const toggleAll = () =>
    setSelected(selected.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map(i => i.id)));

  const toggleRow = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const rowActions = ROW_ACTIONS[activeTab];
  const bulkActions = BULK_ACTIONS[activeTab];

  if (user?.role !== "manager" && user?.role !== "admin") {
    go("/invoices");
    return null;
  }

  const actionBtn = (action: RowAction) => cn(
    "rounded-[7px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap",
    action.danger
      ? "bg-red-600 text-white hover:bg-red-700"
      : action.tid === "fund"
        ? "bg-emerald-600 text-white hover:bg-emerald-700"
        : action.tid === "approve"
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : action.tid === "start_review"
            ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300"
            : "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300"
  );

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Funding Queue" subtitle="Review, approve, and advance factored loads" group="Funding" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] space-y-5 p-6 xl:p-8">

            {/* ── Summary strip ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Pipeline",      value: fmt(pipelineAmount), sub: `${pipelineItems.length} active loads` },
                { label: "Under Review",  value: counts.under_review ?? 0, sub: "awaiting decision", warn: false },
                { label: "Ready to Fund", value: counts.approved ?? 0, sub: "approved, pending advance", warn: false },
                { label: "Held",          value: counts.held ?? 0, sub: "rejected / blocked", warn: (counts.held ?? 0) > 0 },
              ].map(s => (
                <div key={s.label} className="rounded-[12px] border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
                  <p className={cn("mt-0.5 text-[22px] font-bold tracking-tight", s.warn ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white")}>{s.value}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{s.sub}</p>
                </div>
              ))}
            </div>
            <section id="aging-alerts" className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                <div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><AlertTriangle className="h-4 w-4 text-amber-500" /> Aging Alerts</h2><p className="text-[11px] text-slate-500">Funded invoices requiring collections follow-up</p></div>
                <div className="flex gap-1">{(["pending", "resolved"] as const).map(view => <button key={view} onClick={() => setAgingView(view)} className={cn("rounded-full px-3 py-1 text-[11px] font-semibold capitalize", agingView === view ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800")}>{view}</button>)}</div>
              </div>
              {agingAlerts.length === 0 ? <p className="px-5 py-7 text-[12px] text-slate-400">No {agingView} aging alerts.</p> : <div className="overflow-x-auto"><table className="ff-data-table w-full min-w-[680px]"><thead><tr><th>Invoice</th><th>Carrier</th><th>Broker</th><th>Days Funded</th><th>Alert</th><th className="pr-5">Action</th></tr></thead><tbody>{agingAlerts.map(alert => { const urgent = alert.alertType === "day_90"; return <tr key={alert.id}><td><button onClick={() => go(`/invoices/${alert.invoiceId}`)} className="font-mono font-semibold text-blue-700 hover:underline dark:text-blue-400">{alert.invoiceNumber}</button></td><td>{alert.carrier ?? "—"}</td><td>{alert.broker ?? "—"}</td><td>{ageDays(alert.fundedAt) ?? "—"}d</td><td><span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", urgent ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300")}>{urgent ? "90 DAY PAST DUE" : "60 DAY"}</span></td><td className="pr-5">{agingView === "pending" && <Button size="sm" onClick={() => acknowledgeAging.mutate(alert.id)} disabled={acknowledgeAging.isPending} className="h-7 text-[11px]">Acknowledge</Button>}</td></tr>; })}</tbody></table></div>}
            </section>

            {/* ── Queue card ─────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">

              {/* Sticky filter bar */}
              <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-[hsl(var(--card))/95]">
                <div className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {QUEUE_TABS.map(tab => {
                      const count = counts[tab.id] ?? 0;
                      const isActive = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setActiveTab(tab.id); setSelected(new Set()); }}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors",
                            isActive
                              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                          )}
                        >
                          {!isActive && <span className={cn("h-1.5 w-1.5 rounded-full", tab.dot)} />}
                          {tab.label}
                          <span className={cn("text-[10px]", isActive ? "opacity-70" : "opacity-60")}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative shrink-0">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search invoice or load #…"
                      className="h-8 w-[220px] rounded-full pl-9 text-[12px]"
                    />
                  </div>
                </div>

                {/* Bulk action bar */}
                {selected.size > 0 && (
                  <div className="flex items-center gap-3 border-t border-blue-100 bg-blue-50/60 px-5 py-2 dark:border-blue-900/30 dark:bg-blue-950/10">
                    <span className="text-[12px] font-semibold text-blue-700 dark:text-blue-300">
                      {selected.size} selected
                    </span>
                    <div className="h-3.5 w-px bg-blue-200 dark:bg-blue-800" />
                    {bulkActions.map(a => (
                      <button
                        key={a.tid}
                        type="button"
                        onClick={() => handleBulk(a)}
                        disabled={doTransition.isPending}
                        className="rounded-md bg-blue-600 px-3 py-1 text-[11.5px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {a.label}
                      </button>
                    ))}
                    {bulkActions.length === 0 && (
                      <span className="text-[11.5px] text-blue-400">No bulk actions for this queue</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="ml-auto text-[11.5px] font-medium text-blue-500 hover:text-blue-700"
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>

              {/* Table */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16">
                  <FFEmpty context="funding" size="md" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="ff-data-table w-full min-w-[720px]">
                    <thead>
                      <tr>
                        <th className="w-9 pl-5">
                          <button type="button" onClick={toggleAll} className="text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300">
                            {selected.size > 0 && selected.size === rows.length
                              ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" />
                              : <Square className="h-3.5 w-3.5" />}
                          </button>
                        </th>
                        <th>Invoice #</th>
                        <th>Load #</th>
                        <th className="text-right">Amount</th>
                        <th>Age</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th className="pr-5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(inv => {
                        const isSel = selected.has(inv.id);
                        return (
                          <tr key={inv.id} className={cn(isSel && "!bg-blue-50/50 dark:!bg-blue-950/10")}>
                            <td className="pl-5">
                              <button type="button" onClick={() => toggleRow(inv.id)} className="text-slate-400 hover:text-blue-600">
                                {isSel
                                  ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" />
                                  : <Square className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                            <td>
                              <button
                                type="button"
                                onClick={() => go(`/invoices/${inv.id}`)}
                                className="font-mono text-[12px] font-semibold text-blue-700 hover:underline dark:text-blue-400"
                              >
                                {inv.invoiceNumber}
                              </button>
                            </td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {inv.loadNumber ?? (inv.loadId ? `#${inv.loadId}` : "—")}
                            </td>
                            <td className="text-right font-semibold text-slate-900 dark:text-white">
                              {fmt(inv.amount)}
                            </td>
                            <td><AgeBadge date={inv.submittedAt} /></td>
                            <td><FFBadge status={inv.status} size="sm" /></td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {rowActions.map(action => (
                                  <button
                                    key={action.tid}
                                    type="button"
                                    onClick={() => handleRow(inv, action)}
                                    disabled={doTransition.isPending}
                                    className={actionBtn(action)}
                                  >
                                    {action.label}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => go(`/invoices/${inv.id}`)}
                                  title="View detail"
                                  className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                                >
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer */}
              {rows.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                  <span className="text-[11.5px] text-slate-400 dark:text-slate-500">{rows.length} items</span>
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                    {fmt(rows.reduce((s, i) => s + Number(i.amount ?? 0), 0))}
                  </span>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── Reason dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!reasonDlg} onOpenChange={o => !o && setReasonDlg(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {reasonDlg?.tid === "reject"        ? "Reject Invoice"         :
               reasonDlg?.tid === "request_docs"  ? "Request Missing Docs"   : "Confirm Action"}
            </DialogTitle>
          </DialogHeader>
          {reasonDlg?.invoice && (
            <p className="text-sm font-mono text-slate-500">{reasonDlg.invoice.invoiceNumber}</p>
          )}
          {reasonDlg?.bulk && (
            <p className="text-sm text-slate-500">{selected.size} invoices selected</p>
          )}
          <div>
            <Label className="text-[12px] font-semibold">Reason</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Describe the reason…"
              className="mt-1 rounded-xl text-sm"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDlg(null)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={confirmReason}
              disabled={!reason.trim() || doTransition.isPending}
              className={cn(
                "rounded-xl text-white",
                reasonDlg?.tid === "reject"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {doTransition.isPending ? "Processing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

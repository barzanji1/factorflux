import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { PageInsights } from "@/components/PageInsights";
import { FFEmpty } from "@/components/ui/ff-empty";
import { FundingButton as Button, FundingCard as Card, FundingInput as Input, FundingDialogContent as DialogContent } from "@/components/funding/funding-controls";
import { NeuTextarea as Textarea } from "@/styles/neu";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Invoice } from "@shared/schema";
import { Search, AlertTriangle, SquareCheck, Square, ChevronRight } from "lucide-react";
import "@/components/funding/funding-neu.css";
import { NeuPageShell, NeuTable, NeuTableHeader, NeuTableHead, NeuTableBody, NeuTableRow, NeuTableCell, NeuTabs, NeuTabList, NeuTab } from "@/styles/neu/components";
import { NeuButton } from "@/styles/neu";
import { FundingStatCard } from "@/components/funding/funding-stat-card";
import { FundingBadge } from "@/components/funding/funding-badge";
import { FundingStatusBadge } from "@/components/funding/funding-status-badge";

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

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({ queryKey: ["/api/invoices", { all: true }] });
  type AgingAlert = { id: number; invoiceId: number; invoiceNumber: string; carrier: string | null; broker: string | null; fundedAt: string; alertType: "day_60" | "day_90"; status: string };
  const [agingView, setAgingView] = useState<"pending" | "resolved">("pending");
  const { data: agingAlerts = [] } = useQuery<AgingAlert[]>({
    queryKey: ["/api/invoices/aging-alerts", agingView],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/invoices/aging-alerts?view=${agingView}`);
      return response.json();
    },
  });
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
    "px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap",
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
    <div className="funding-neu-page flex h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Funding Queue" subtitle="Review, approve, and advance factored loads" group="Funding" neu />
        <NeuPageShell className="custom-scrollbar flex-1 overflow-auto">
          <PageInsights entity="factoring" title="Factoring activity" />
          <div className="mx-auto w-full max-w-[1680px] space-y-5 p-6 xl:p-8">

            {/* ── Summary strip ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Pipeline",      value: fmt(pipelineAmount), sub: `${pipelineItems.length} active loads` },
                { label: "Under Review",  value: counts.under_review ?? 0, sub: "awaiting decision", warn: false },
                { label: "Ready to Fund", value: counts.approved ?? 0, sub: "approved, pending advance", warn: false },
                { label: "Held",          value: counts.held ?? 0, sub: "rejected / blocked", warn: (counts.held ?? 0) > 0 },
              ].map(s => (
                <FundingStatCard key={s.label} label={s.label} value={s.value} detail={s.sub} className="min-h-32 p-4" />
              ))}
            </div>
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                <div><h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><AlertTriangle className="h-4 w-4 text-amber-500" /> Aging Alerts</h2><p className="text-[11px] text-slate-500">Funded invoices requiring collections follow-up</p></div>
                <div className="flex gap-1">{(["pending", "resolved"] as const).map(view => <NeuButton key={view} onClick={() => setAgingView(view)} className={cn("!min-h-8 rounded-full px-3 py-1 text-[11px] font-semibold capitalize", agingView === view ? "!bg-[#cbdedb] !text-[#146d72]" : "!bg-[#e0e0e0] !text-slate-600")}>{view}</NeuButton>)}</div>
              </div>
              {agingAlerts.length === 0 ? <p className="px-5 py-7 text-[12px] text-slate-400">No {agingView} aging alerts.</p> : <NeuTable className="w-full min-w-[680px]"><NeuTableHeader><tr>{["Invoice", "Carrier", "Broker", "Days Funded", "Alert", "Action"].map(label => <NeuTableHead key={label}>{label}</NeuTableHead>)}</tr></NeuTableHeader><NeuTableBody>{agingAlerts.map(alert => {
                const urgent = alert.alertType === "day_90";
                return <NeuTableRow key={alert.id}>
                  <NeuTableCell><NeuButton onClick={() => go(`/invoices/${alert.invoiceId}`)} className="!min-h-7 !bg-transparent !px-1 !py-0 font-mono font-semibold !text-[#168d99] !shadow-none hover:underline">{alert.invoiceNumber}</NeuButton></NeuTableCell>
                  <NeuTableCell>{alert.carrier ?? "—"}</NeuTableCell><NeuTableCell>{alert.broker ?? "—"}</NeuTableCell>
                  <NeuTableCell>{ageDays(alert.fundedAt) ?? "—"}d</NeuTableCell>
                  <NeuTableCell><FundingBadge tone={urgent ? "warning" : "accent"}>{urgent ? "90 DAY PAST DUE" : "60 DAY"}</FundingBadge></NeuTableCell>
                  <NeuTableCell>{agingView === "pending" && <Button size="sm" onClick={() => acknowledgeAging.mutate(alert.id)} disabled={acknowledgeAging.isPending} className="h-7 text-[11px]">Acknowledge</Button>}</NeuTableCell>
                </NeuTableRow>;
              })}</NeuTableBody></NeuTable>}
            </Card>

            {/* ── Queue card ─────────────────────────────────────────────── */}
            <Card className="overflow-hidden">

              {/* Sticky filter bar */}
              <div className="sticky top-0 z-10 border-b border-slate-100 bg-white dark:border-slate-800">
                <div className="flex flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <NeuTabs value={activeTab} onValueChange={value => { setActiveTab(value as QTabId); setSelected(new Set()); }} className="w-auto">
                    <NeuTabList className="gap-1.5">
                      {QUEUE_TABS.map(tab => (
                        <NeuTab key={tab.id} value={tab.id} className="flex items-center gap-1.5 px-3 text-[11.5px]">
                          {tab.label}<span className="text-[10px] opacity-60">{counts[tab.id] ?? 0}</span>
                        </NeuTab>
                      ))}
                    </NeuTabList>
                  </NeuTabs>
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
                      <NeuButton
                        key={a.tid}
                        type="button"
                        onClick={() => handleBulk(a)}
                        disabled={doTransition.isPending}
                        variant="accent"
                        className="!min-h-8 rounded-xl px-3 py-1 text-[11.5px] font-semibold"
                      >
                        {a.label}
                      </NeuButton>
                    ))}
                    {bulkActions.length === 0 && (
                      <span className="text-[11.5px] text-blue-400">No bulk actions for this queue</span>
                    )}
                    <NeuButton
                      type="button"
                      onClick={() => setSelected(new Set())}
                      className="ml-auto !min-h-8 !bg-transparent px-2 text-[11.5px] font-medium !text-[#168d99] !shadow-none hover:underline"
                    >
                      Clear selection
                    </NeuButton>
                  </div>
                )}
              </div>

              {/* Table */}
              {isLoading ? (
                <div className="space-y-3 px-4 py-8" aria-label="Loading invoices">
                  {[0, 1, 2, 3].map(row => <div key={row} className="grid grid-cols-[1fr_2fr_1fr] gap-4 rounded-xl bg-[#e0e0e0] p-4 shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><span className="h-3 animate-pulse rounded bg-[#ccd5d2]" /><span className="h-3 animate-pulse rounded bg-[#ccd5d2]" /><span className="h-3 animate-pulse rounded bg-[#ccd5d2]" /></div>)}
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16">
                  <FFEmpty context="funding" size="md" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <NeuTable className="ff-data-table w-full min-w-[720px]">
                    <thead>
                      <tr>
                        <th className="w-9 pl-5">
                          <NeuButton type="button" onClick={toggleAll} aria-label="Select all invoices" className="!min-h-8 !w-8 !rounded-full !p-0 !text-slate-500">
                            {selected.size > 0 && selected.size === rows.length
                              ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" />
                              : <Square className="h-3.5 w-3.5" />}
                          </NeuButton>
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
                              <NeuButton type="button" onClick={() => toggleRow(inv.id)} aria-label={`Select invoice ${inv.invoiceNumber}`} className="!min-h-8 !w-8 !rounded-full !p-0 !text-[#168d99]">
                                {isSel
                                  ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" />
                                  : <Square className="h-3.5 w-3.5" />}
                              </NeuButton>
                            </td>
                            <td>
                              <NeuButton
                                type="button"
                                onClick={() => go(`/invoices/${inv.id}`)}
                                className="!min-h-8 !bg-transparent !px-1 !py-0 font-mono text-[12px] font-semibold !text-[#168d99] !shadow-none hover:underline"
                              >
                                {inv.invoiceNumber}
                              </NeuButton>
                            </td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {inv.loadNumber ?? (inv.loadId ? `#${inv.loadId}` : "—")}
                            </td>
                            <td className="text-right font-semibold text-slate-900 dark:text-white">
                              {fmt(inv.amount)}
                            </td>
                            <td><AgeBadge date={inv.submittedAt} /></td>
                            <td><FundingStatusBadge status={inv.status} size="sm" /></td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {rowActions.map(action => (
                                  <NeuButton
                                    key={action.tid}
                                    type="button"
                                    onClick={() => handleRow(inv, action)}
                                    disabled={doTransition.isPending}
                                    className={actionBtn(action)}
                                  >
                                    {action.label}
                                  </NeuButton>
                                ))}
                                <NeuButton
                                  type="button"
                                  onClick={() => go(`/invoices/${inv.id}`)}
                                  title="View detail"
                                  className="!min-h-8 !w-8 !rounded-full !p-0 !text-slate-500"
                                >
                                  <ChevronRight className="h-3 w-3" />
                                </NeuButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </NeuTable>
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
            </Card>
          </div>
        </NeuPageShell>
      </div>

      {/* ── Reason dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!reasonDlg} onOpenChange={o => !o && setReasonDlg(null)}>
        <DialogContent className="funding-neu-dialog max-w-sm">
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
              className="mt-1 text-sm"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDlg(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmReason}
              disabled={!reason.trim() || doTransition.isPending}
              className={cn(
                "text-white",
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

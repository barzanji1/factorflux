import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FFEmpty } from "@/components/ui/ff-empty";
import { FFOnboarding } from "@/components/ui/ff-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Edit2, Trash2, AlertTriangle, DollarSign,
  SquareCheck, Square, Mail,
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

// ── Types & helpers ───────────────────────────────────────────────────────────
interface Collection {
  id: number;
  clientId: number;
  invoiceId?: number;
  amount: string;
  description: string;
  status: "pending" | "in_progress" | "paid" | "written_off";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string;
  lastContactDate?: string;
  notes?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  client?: { id: number; name: string; status: string };
  assignedUser?: { id: string; firstName?: string; lastName?: string };
}

const fmt = (n: string | number) =>
  `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function overdueDays(dueDate: string): number {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
}

function OverduePill({ dueDate }: { dueDate: string }) {
  const days = overdueDays(dueDate);
  if (days <= 0) {
    const daysLeft = Math.abs(days);
    return (
      <span className="text-[11px] text-slate-400 dark:text-slate-500">
        {daysLeft === 0 ? "Due today" : `${daysLeft}d left`}
      </span>
    );
  }
  if (days <= 7)  return <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{days}d over</span>;
  if (days <= 30) return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-orange-600 dark:text-orange-400">
      <AlertTriangle className="h-3 w-3" />{days}d over
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
      <AlertTriangle className="h-3 w-3" />{days}d over
    </span>
  );
}

function rowUrgencyClass(c: Collection): string {
  const od = overdueDays(c.dueDate);
  const active = ["pending", "in_progress"].includes(c.status);
  if (!active) return "";
  if ((c.priority === "urgent" && od > 0) || od > 30) return "ff-row-urgent";
  if (c.priority === "high" || od > 7) return "ff-row-stale";
  return "";
}

const PRIORITY_CLASS: Record<string, string> = {
  low:    "text-slate-500 dark:text-slate-400",
  medium: "text-blue-600 dark:text-blue-400",
  high:   "text-orange-600 dark:text-orange-400",
  urgent: "font-bold text-red-600 dark:text-red-400",
};

const QUEUE_TABS = [
  { id: "all",         label: "All",         filter: null as null | string[] },
  { id: "pending",     label: "Pending",     filter: ["pending"]     },
  { id: "in_progress", label: "In Progress", filter: ["in_progress"] },
  { id: "overdue",     label: "Overdue",     filter: ["pending", "in_progress"], overdueFn: true },
  { id: "paid",        label: "Paid",        filter: ["paid"]        },
  { id: "written_off", label: "Written Off", filter: ["written_off"] },
] as const;

type QTabId = typeof QUEUE_TABS[number]["id"];

// ── Form schema ───────────────────────────────────────────────────────────────
const collectionSchema = z.object({
  clientId:    z.coerce.number().min(1, "Client required"),
  amount:      z.string().min(1, "Amount required"),
  description: z.string().min(1, "Description required"),
  status:      z.enum(["pending", "in_progress", "paid", "written_off"]).default("pending"),
  priority:    z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate:     z.string().min(1, "Due date required"),
  notes:       z.string().optional(),
  assignedTo:  z.string().optional(),
});
type CollectionForm = z.infer<typeof collectionSchema>;

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CollectionsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useStickyState<QTabId>("ff:collections:tab", "all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const form = useForm<CollectionForm>({
    resolver: zodResolver(collectionSchema),
    defaultValues: { status: "pending", priority: "medium" },
  });

  // ── Queries ──────────────────────────────────────────────────────
  const { data: collections = [], isLoading } = useQuery<Collection[]>({ queryKey: ["/api/collections"] });
  const { data: clients = [] } = useQuery<any[]>({ queryKey: ["/api/clients", { all: true }] });
  const { data: brokerFollowUps = [] } = useQuery<{ invoiceId: number; status: string }[]>({
    queryKey: ["/api/broker-follow-ups"],
    select: (data: any[]) => data.map((d: any) => ({ invoiceId: d.invoiceId, status: d.status })),
  });

  // Derive a set of invoiceIds with active (non-acknowledged) broker follow-ups
  const followUpInvoiceIds = useMemo(
    () => new Set(brokerFollowUps.filter(b => b.status !== "acknowledged").map(b => b.invoiceId)),
    [brokerFollowUps],
  );

  // Saved views
  const { allViews: savedViews } = useSavedViews("collections");

  function applyView(view: SavedView) {
    if (view.filters.tab) setActiveTab(view.filters.tab as QTabId);
    setActiveViewId(view.id);
    setSelected(new Set());
  }

  // ── Derived counts ───────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: collections.length };
    c.pending     = collections.filter(x => x.status === "pending").length;
    c.in_progress = collections.filter(x => x.status === "in_progress").length;
    c.overdue     = collections.filter(x =>
      ["pending", "in_progress"].includes(x.status) && overdueDays(x.dueDate) > 0
    ).length;
    c.paid        = collections.filter(x => x.status === "paid").length;
    c.written_off = collections.filter(x => x.status === "written_off").length;
    return c;
  }, [collections]);

  const totalOwed = collections
    .filter(c => ["pending", "in_progress"].includes(c.status))
    .reduce((s, c) => s + Number(c.amount), 0);

  const overdueAmount = collections
    .filter(c => ["pending", "in_progress"].includes(c.status) && overdueDays(c.dueDate) > 0)
    .reduce((s, c) => s + Number(c.amount), 0);

  // ── Filtered rows ────────────────────────────────────────────────
  const rows = useMemo(() => {
    const tab = QUEUE_TABS.find(t => t.id === activeTab)!;
    let items = tab.filter
      ? collections.filter(c => (tab.filter as string[]).includes(c.status))
      : collections;
    if ((tab as any).overdueFn) items = items.filter(c => overdueDays(c.dueDate) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(c =>
        c.client?.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    }
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    return [...items].sort((a, b) => {
      const pd = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (pd !== 0) return pd;
      return overdueDays(b.dueDate) - overdueDays(a.dueDate);
    });
  }, [collections, activeTab, search]);

  // ── Mutations ────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async (data: CollectionForm) => {
      const res = await fetch("/api/collections", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, clientId: Number(data.clientId), dueDate: new Date(data.dueDate).toISOString() }),
      });
      if (!res.ok) throw new Error("Failed to create collection");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/collections"] });
      setDlgOpen(false); form.reset();
      toast({ title: "Collection created" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create collection", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<CollectionForm> }) => {
      const res = await fetch(`/api/collections/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update collection");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/collections"] });
      setDlgOpen(false); setEditing(null); form.reset();
      toast({ title: "Collection updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update collection", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/collections/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/collections"] });
      toast({ title: "Collection deleted" });
    },
  });

  const onSubmit = (data: CollectionForm) => {
    if (editing) updateMut.mutate({ id: editing.id, updates: data });
    else createMut.mutate(data);
  };

  const openCreate = () => { setEditing(null); form.reset({ status: "pending", priority: "medium" }); setDlgOpen(true); };
  const openEdit = (c: Collection) => {
    setEditing(c);
    form.reset({
      clientId: c.clientId, amount: c.amount, description: c.description,
      status: c.status, priority: c.priority,
      dueDate: new Date(c.dueDate).toISOString().split("T")[0],
      notes: c.notes ?? "", assignedTo: c.assignedTo ?? "",
    });
    setDlgOpen(true);
  };

  const bulkUpdateStatus = useCallback((status: string) => {
    Promise.all(Array.from(selected).map(id => updateMut.mutateAsync({ id, updates: { status: status as any } })))
      .then(() => { toast({ title: `${selected.size} updated` }); setSelected(new Set()); })
      .catch(() => {});
  }, [selected, updateMut, toast]);

  const toggleAll = () =>
    setSelected(selected.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map(c => c.id)));
  const toggleRow = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const STATUS_ACTIONS: Record<QTabId, Array<{ label: string; nextStatus: string }>> = {
    all:         [],
    pending:     [{ label: "Start", nextStatus: "in_progress" }],
    in_progress: [{ label: "Mark Paid", nextStatus: "paid" }, { label: "Write Off", nextStatus: "written_off" }],
    overdue:     [{ label: "Mark Paid", nextStatus: "paid" }, { label: "Write Off", nextStatus: "written_off" }],
    paid:        [],
    written_off: [],
  };
  const rowStatusActions = STATUS_ACTIONS[activeTab];

  const BULK_STATUS: Record<QTabId, Array<{ label: string; nextStatus: string }>> = {
    all:         [],
    pending:     [{ label: "Start All", nextStatus: "in_progress" }],
    in_progress: [{ label: "Mark Paid", nextStatus: "paid" }, { label: "Write Off", nextStatus: "written_off" }],
    overdue:     [{ label: "Mark Paid", nextStatus: "paid" }, { label: "Write Off", nextStatus: "written_off" }],
    paid:        [],
    written_off: [],
  };
  const bulkStatusActions = BULK_STATUS[activeTab];

  return (
    <div className="flex h-screen bg-[#d4d0c8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Collections" subtitle="Manage funds owed to TPF and track carrier performance" group="Recovery" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] space-y-4 p-6 xl:p-8">

            {/* ── Overdue nudge banner ────────────────────────────────────── */}
            {counts.overdue > 0 && (
              <div className="flex items-center gap-3 rounded-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-white px-4 py-3 shadow-[2px_2px_0_rgba(128,128,128,0.45)]">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-[12.5px] font-medium text-amber-800 dark:text-amber-300">
                  <span className="font-bold">{counts.overdue} account{counts.overdue !== 1 ? "s" : ""}</span> overdue —{" "}
                  <span className="font-semibold">{fmt(overdueAmount)}</span> at risk
                </p>
                <button
                  type="button"
                  onClick={() => { setActiveTab("overdue"); setActiveViewId("overdue"); setSelected(new Set()); }}
                  className="ml-auto whitespace-nowrap text-[11.5px] font-semibold text-amber-600 hover:text-amber-700 dark:text-amber-400"
                >
                  View overdue →
                </button>
              </div>
            )}

            {/* ── Summary strip ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Total Owed",  value: fmt(totalOwed),             sub: `${(counts.pending ?? 0) + (counts.in_progress ?? 0)} active cases` },
                { label: "Pending",     value: counts.pending ?? 0,        sub: "not yet started" },
                { label: "In Progress", value: counts.in_progress ?? 0,    sub: "being worked" },
                { label: "Overdue",     value: counts.overdue ?? 0,        sub: "past due date", warn: (counts.overdue ?? 0) > 0 },
              ].map(s => (
                <div key={s.label} className="rounded-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-white px-4 py-3 shadow-[2px_2px_0_rgba(128,128,128,0.45)]">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
                  <p className={cn("mt-0.5 text-[22px] font-bold tracking-tight", (s as any).warn ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white")}>{s.value}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* ── Queue card ─────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-white shadow-[2px_2px_0_rgba(128,128,128,0.45)]">

              {/* Sticky filter bar */}
              <div className="sticky top-0 z-10 border-b-2 border-[#808080] bg-[#d4d0c8]">

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
                          ? "border-[#087888] bg-[#27aab8] text-white"
                          : "border-[#808080] bg-white text-slate-600 hover:bg-[#dff5f6]"
                      )}
                    >
                      <span>{view.emoji}</span> {view.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-3 px-5 py-2.5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {QUEUE_TABS.map(tab => {
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
                              ? "border-2 border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] text-white"
                              : "border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-white text-slate-600 hover:bg-[#dff5f6]",
                            tab.id === "overdue" && !isActive && count > 0 && "bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-400"
                          )}
                        >
                          {tab.label} <span className="opacity-60">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search client or description…"
                        className="h-8 w-[220px] rounded-lg border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white bg-white pl-9 text-[12px] shadow-[inset_1px_1px_0_rgba(0,0,0,0.15)]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={openCreate}
                      className="flex items-center gap-1.5 rounded-lg border-2 border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[1px_1px_0_#808080] hover:bg-[#098b9f]"
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
                    {bulkStatusActions.map(a => (
                      <button
                        key={a.nextStatus}
                        type="button"
                        onClick={() => bulkUpdateStatus(a.nextStatus)}
                        disabled={updateMut.isPending}
                        className={cn(
                          "rounded-lg border-2 px-3 py-1 text-[11.5px] font-semibold text-white shadow-[1px_1px_0_#808080] disabled:opacity-50",
                          a.nextStatus === "paid" ? "bg-emerald-600 hover:bg-emerald-700"
                            : a.nextStatus === "written_off" ? "bg-slate-600 hover:bg-slate-700"
                            : "border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] hover:bg-[#098b9f]"
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[11.5px] font-medium text-blue-500 hover:text-blue-700">
                      Clear
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
                <div className="m-4 rounded-xl border-2 border-dashed border-[#808080] bg-white px-8 py-10">
                  {collections.length === 0 ? (
                    <FFOnboarding
                      title="No collection cases yet"
                      description="Track funds owed to TPF — from first contact to final payment or write-off."
                      icon={DollarSign}
                      steps={[
                        { label: "Create a case for each outstanding debt", detail: "Include amount, client, and a due date" },
                        { label: "Set priority — urgent cases surface first in the queue" },
                        { label: "Work the case: update status as you make contact" },
                        { label: "Mark paid or write off when resolved" },
                      ]}
                      primaryAction={{ label: "New Collection", onClick: openCreate }}
                      hint="Tip: Collections are sorted by priority and overdue days — most urgent cases always appear first."
                    />
                  ) : (
                    <div className="py-8 text-center">
                      <FFEmpty context="collections" size="md" />
                      <button
                        type="button"
                        onClick={() => { setActiveTab("all"); setSearch(""); setActiveViewId(null); }}
                        className="mt-3 text-[12px] font-semibold text-blue-600 hover:text-blue-700"
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-b-xl">
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
                        <th>Client</th>
                        <th className="text-right">Amount</th>
                        <th>Description</th>
                        <th>Priority</th>
                        <th>Due Date</th>
                        <th>Overdue</th>
                        <th>Status</th>
                        <th>Owner</th>
                        <th className="pr-5">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c, index) => {
                        const isSel = selected.has(c.id);
                        return (
                          <tr key={c.id} className={cn(index % 2 === 0 ? "bg-white" : "bg-[#f0f0f0]", rowUrgencyClass(c), isSel && "!bg-[#dff5f6]")}>
                            <td className="pl-5">
                              <button type="button" onClick={() => toggleRow(c.id)} className="text-slate-400 hover:text-blue-600">
                                {isSel ? <SquareCheck className="h-3.5 w-3.5 text-blue-600" /> : <Square className="h-3.5 w-3.5" />}
                              </button>
                            </td>
                            <td className="font-medium text-slate-900 dark:text-white">
                              <div className="flex items-center gap-1.5">
                                {c.client?.name ?? <span className="text-slate-400">Unknown</span>}
                                {c.invoiceId && followUpInvoiceIds.has(c.invoiceId) && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400 px-1.5 py-0.5 text-[9.5px] font-bold border border-orange-200 dark:border-orange-800"
                                    title="Active broker follow-up pending"
                                  >
                                    <Mail className="h-2.5 w-2.5" />
                                    Follow-up
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="text-right font-semibold text-red-600 dark:text-red-400">
                              {fmt(c.amount)}
                            </td>
                            <td className="max-w-[200px] truncate text-slate-600 dark:text-slate-400">
                              {c.description}
                            </td>
                            <td>
                              <span className={cn("text-[11.5px] font-semibold capitalize", PRIORITY_CLASS[c.priority])}>
                                {c.priority}
                              </span>
                            </td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {new Date(c.dueDate).toLocaleDateString()}
                            </td>
                            <td><OverduePill dueDate={c.dueDate} /></td>
                            <td>
                              <CollectionStatusBadge status={c.status} />
                            </td>
                            <td className="text-[11.5px] text-slate-500 dark:text-slate-400">
                              {c.assignedUser
                                ? `${c.assignedUser.firstName ?? ""} ${c.assignedUser.lastName ?? ""}`.trim() || "Assigned"
                                : <span className="text-slate-300 dark:text-slate-600">—</span>}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {rowStatusActions.map(a => (
                                  <button
                                    key={a.nextStatus}
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: c.id, updates: { status: a.nextStatus as any } })}
                                    disabled={updateMut.isPending}
                                    className={cn(
                                      "rounded-[7px] px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50",
                                      a.nextStatus === "paid"
                                        ? "border-2 border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] text-white hover:bg-[#098b9f]"
                                        : a.nextStatus === "written_off"
                                          ? "bg-slate-600 text-white hover:bg-slate-700"
                                          : "border-2 border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] text-white hover:bg-[#098b9f]"
                                    )}
                                  >
                                    {a.label}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => openEdit(c)}
                                  className="bevel-button flex h-6 w-6 items-center justify-center rounded-md bg-[#d4d0c8] text-slate-600"
                                  title="Edit"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { if (confirm("Delete this collection?")) deleteMut.mutate(c.id); }}
                                  className="bevel-button flex h-6 w-6 items-center justify-center rounded-md bg-[#d4d0c8] text-red-600"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
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

              {rows.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                  <span className="text-[11.5px] text-slate-400">{rows.length} items</span>
                  <span className="text-[12px] font-semibold text-red-600 dark:text-red-400">
                    {fmt(rows.filter(c => ["pending","in_progress"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0))} owed
                  </span>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── Create / Edit dialog ──────────────────────────────────────────── */}
      <Dialog open={dlgOpen} onOpenChange={o => { if (!o) { setDlgOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg rounded-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-white shadow-[2px_2px_0_rgba(128,128,128,0.45)]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Collection" : "New Collection"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="clientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <Select onValueChange={v => field.onChange(Number(v))} value={field.value?.toString()}>
                      <FormControl><SelectTrigger className="rounded-xl"><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {clients.map((c: any) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" className="rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl><Input {...field} placeholder="Describe the collection case…" className="rounded-xl" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-3 gap-4">
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="written_off">Written Off</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="dueDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl><Input {...field} type="date" className="rounded-xl" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><textarea {...field} rows={2} placeholder="Optional notes…" className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDlgOpen(false)} className="rounded-xl border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#d4d0c8] shadow-[1px_1px_0_#808080]">Cancel</Button>
                <Button type="submit" disabled={createMut.isPending || updateMut.isPending} className="rounded-xl border-2 border-t-[#64d5dc] border-l-[#64d5dc] border-b-[#087888] border-r-[#087888] bg-[#27aab8] text-white shadow-[1px_1px_0_#808080] hover:bg-[#098b9f]">
                  {(createMut.isPending || updateMut.isPending) ? "Saving…" : editing ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CollectionStatusBadge({ status }: { status: string }) {
  const MAP: Record<string, string> = {
    pending:     "ff-badge ff-badge-pending",
    in_progress: "ff-badge ff-badge-under_review",
    paid:        "ff-badge ff-badge-paid",
    written_off: "ff-badge ff-badge-rejected",
  };
  const LABELS: Record<string, string> = {
    pending: "Pending", in_progress: "In Progress", paid: "Paid", written_off: "Written Off",
  };
  return <span className={MAP[status] ?? "ff-badge ff-badge-draft"}>{LABELS[status] ?? status}</span>;
}

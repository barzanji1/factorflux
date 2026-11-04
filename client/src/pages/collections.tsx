import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageInsights } from "@/components/PageInsights";
import { NeuTable } from "@/styles/neu/components";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FFEmpty } from "@/components/ui/ff-empty";
import { FFOnboarding } from "@/components/ui/ff-onboarding";
import { Button, Input, Textarea, Card, DialogContent, SelectContent, SelectTrigger, AdminPageShell, Badge } from "@/components/admin-neu/adapters";
import {
  Dialog, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectItem, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus, Search, Edit2, Trash2, AlertTriangle, DollarSign,
  SquareCheck, Square, Mail,
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
      <span className="text-[11px] text-[#777]">
        {daysLeft === 0 ? "Due today" : `${daysLeft}d left`}
      </span>
    );
  }
  if (days <= 7)  return <span className="text-[11px] font-semibold text-[#9b6a22]">{days}d over</span>;
  if (days <= 30) return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#9b6a22]">
      <AlertTriangle className="h-3 w-3" />{days}d over
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-[#a3483e]">
      <AlertTriangle className="h-3 w-3" />{days}d over
    </span>
  );
}

const PRIORITY_CLASS: Record<string, string> = {
  low:    "text-[#777]",
  medium: "text-[#168d99]",
  high:   "text-[#9b6a22]",
  urgent: "font-bold text-[#a3483e]",
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
    <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Collections" subtitle="Manage funds owed to TPF and track carrier performance" group="Recovery" />
        <AdminPageShell className="custom-scrollbar flex-1 overflow-auto !min-h-0">
          <div className="mx-auto w-full max-w-[1680px] space-y-4 p-6 xl:p-8">
            <PageInsights entity="collections" title="Collections performance" />

            {/* ── Overdue nudge banner ────────────────────────────────────── */}
            {counts.overdue > 0 && (
              <div className="flex items-center gap-3 rounded-xl bg-[#e0e0e0] px-4 py-3 shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-[12.5px] font-medium text-[#825d22]">
                  <span className="font-bold">{counts.overdue} account{counts.overdue !== 1 ? "s" : ""}</span> overdue —{" "}
                  <span className="font-semibold">{fmt(overdueAmount)}</span> at risk
                </p>
                <Button
                  type="button"
                  onClick={() => { setActiveTab("overdue"); setActiveViewId("overdue"); setSelected(new Set()); }}
                  variant="ghost"
                  className="ml-auto whitespace-nowrap text-[11.5px] font-semibold text-[#9b6a22]"
                >
                  View overdue →
                </Button>
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
                <Card key={s.label} className="rounded-2xl p-4">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#777]">{s.label}</p>
                  <p className={cn("mt-0.5 text-[22px] font-bold tracking-tight", (s as any).warn ? "text-[#a3483e]" : "text-[#333]")}>{s.value}</p>
                  <p className="text-[11px] text-[#777]">{s.sub}</p>
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
                  <div className="flex flex-wrap gap-1.5">
                    {QUEUE_TABS.map(tab => {
                      const count = counts[tab.id] ?? 0;
                      const isActive = activeTab === tab.id;
                      return (
                        <Button
                          key={tab.id}
                          type="button"
                          onClick={() => { setActiveTab(tab.id); setSelected(new Set()); setActiveViewId(null); }}
                          variant={isActive ? "accent" : "ghost"}
                          size="sm"
                          className={cn("rounded-full px-3 py-1 text-[11.5px]", tab.id === "overdue" && !isActive && count > 0 && "text-[#a3483e]")}
                        >
                          {tab.label} <span className="opacity-60">{count}</span>
                        </Button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888]" />
                      <Input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search client or description…"
                        className="h-9 w-[220px] rounded-xl pl-9 text-[12px]"
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={openCreate}
                      variant="accent"
                      size="sm"
                      className="flex items-center gap-1.5 px-3 text-[11.5px]"
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
                    {bulkStatusActions.map(a => (
                      <Button
                        key={a.nextStatus}
                        type="button"
                        onClick={() => bulkUpdateStatus(a.nextStatus)}
                        disabled={updateMut.isPending}
                        variant={a.nextStatus === "paid" ? "accent" : "outline"}
                        size="sm"
                        className="px-3 py-1 text-[11.5px]"
                      >
                        {a.label}
                      </Button>
                    ))}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())} className="ml-auto text-[11.5px] font-medium text-[#168d99]">
                      Clear
                    </Button>
                  </div>
                )}
              </div>

              {/* Table */}
              {isLoading ? (
                  <div className="space-y-3 p-5">{[0, 1, 2].map((row) => <div key={row} className="h-12 animate-pulse rounded-xl bg-[#d2d2d2]" />)}</div>
              ) : rows.length === 0 ? (
                <div className="m-4 rounded-2xl bg-[#e0e0e0] px-8 py-10 shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]">
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
                      <Button
                        type="button"
                        onClick={() => { setActiveTab("all"); setSearch(""); setActiveViewId(null); }}
                        variant="ghost"
                        className="mt-3 text-[12px] font-semibold text-[#168d99]"
                      >
                        Clear filters
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
                      {rows.map((c) => {
                        const isSel = selected.has(c.id);
                        return (
                          <tr key={c.id} className={cn("transition-colors hover:bg-[#dceaea]", isSel && "bg-[#d7eaea]")}>
                            <td className="pl-5">
                              <Button type="button" variant="ghost" size="icon" onClick={() => toggleRow(c.id)} className="h-7 w-7 text-[#777]">
                                {isSel ? <SquareCheck className="h-3.5 w-3.5 text-[#168d99]" /> : <Square className="h-3.5 w-3.5" />}
                              </Button>
                            </td>
                            <td className="font-medium text-[#333]">
                              <div className="flex items-center gap-1.5">
                                {c.client?.name ?? <span className="text-[#888]">Unknown</span>}
                                {c.invoiceId && followUpInvoiceIds.has(c.invoiceId) && (
                                  <Badge tone="warning" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9.5px]" title="Active broker follow-up pending">
                                    <Mail className="h-2.5 w-2.5" />
                                    Follow-up
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="text-right font-semibold text-[#555]">
                              {fmt(c.amount)}
                            </td>
                            <td className="max-w-[200px] truncate text-[#555]">
                              {c.description}
                            </td>
                            <td>
                              <span className={cn("text-[11.5px] font-semibold capitalize", PRIORITY_CLASS[c.priority])}>
                                {c.priority}
                              </span>
                            </td>
                            <td className="text-[#666]">
                              {new Date(c.dueDate).toLocaleDateString()}
                            </td>
                            <td><OverduePill dueDate={c.dueDate} /></td>
                            <td>
                              <CollectionStatusBadge status={c.status} />
                            </td>
                            <td className="text-[11.5px] text-[#666]">
                              {c.assignedUser
                                ? `${c.assignedUser.firstName ?? ""} ${c.assignedUser.lastName ?? ""}`.trim() || "Assigned"
                                : <span className="text-[#999]">—</span>}
                            </td>
                            <td className="pr-5">
                              <div className="flex items-center gap-1.5">
                                {rowStatusActions.map(a => (
                                  <Button
                                    key={a.nextStatus}
                                    type="button"
                                    onClick={() => updateMut.mutate({ id: c.id, updates: { status: a.nextStatus as any } })}
                                    disabled={updateMut.isPending}
                                    variant={a.nextStatus === "paid" ? "accent" : "outline"}
                                    size="sm"
                                    className="whitespace-nowrap px-2.5 py-1.5 text-[11px]"
                                  >
                                    {a.label}
                                  </Button>
                                ))}
                                <Button
                                  type="button"
                                  onClick={() => openEdit(c)}
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-[#168d99]"
                                  title="Edit"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => { if (confirm("Delete this collection?")) deleteMut.mutate(c.id); }}
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-[#a3483e]"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
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
                  <span className="text-[12px] font-semibold text-[#555]">
                    {fmt(rows.filter(c => ["pending","in_progress"].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0))} owed
                  </span>
                </div>
              )}
            </Card>
          </div>
        </AdminPageShell>
      </div>

      {/* ── Create / Edit dialog ──────────────────────────────────────────── */}
      <Dialog open={dlgOpen} onOpenChange={o => { if (!o) { setDlgOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8]">
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
                  <FormControl><Textarea {...field} rows={2} placeholder="Optional notes…" className="min-h-20 resize-none" /></FormControl>
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDlgOpen(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={createMut.isPending || updateMut.isPending}>
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
  const LABELS: Record<string, string> = {
    pending: "Pending", in_progress: "In Progress", paid: "Paid", written_off: "Written Off",
  };
  return <Badge tone={status === "paid" ? "success" : status === "written_off" ? "warning" : status === "in_progress" ? "accent" : "neutral"}>{LABELS[status] ?? status}</Badge>;
}

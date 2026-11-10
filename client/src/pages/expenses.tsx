import { useEffect, useMemo, useState } from "react";
import { AdminPageShell, Button, Input, Badge, Card, CardContent, CardHeader, CardTitle, DialogContent, SelectContent, useAdminToast, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin-neu/adapters";
import "@/components/admin-neu/admin-neu-page.css";
import { useMutation, useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import { TopNav } from "@/components/admin-neu/adapters";
import { PageInsights } from "@/components/PageInsights";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Label } from "@/components/ui/label";
import { NeuTextarea as Textarea } from "@/styles/neu";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Download, Check, X, Receipt, Loader2 } from "lucide-react";

type Expense = Record<string, any>;
const rows = (v: any): Expense[] => Array.isArray(v) ? v : v?.items || v?.data || [];
const money = (v: any) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0));
const date = (v: any) => v ? new Date(v).toLocaleDateString() : "—";
const statusLabel: Record<string, string> = { draft: "Draft", submitted: "Pending approval", pending: "Pending approval", approved: "Approved", rejected: "Rejected", reimbursed: "Reimbursed" };
const statusClass: Record<string, string> = {
  draft: "ff-badge-draft",
  submitted: "ff-badge-submitted",
  pending: "ff-badge-submitted",
  approved: "ff-badge-funded",
  rejected: "ff-badge-rejected",
  reimbursed: "ff-expenses-status-reimbursed",
};
const categoryClass: Record<string, string> = {
  fuel: "ff-badge-pending",
  office: "ff-badge-submitted",
  travel: "ff-expenses-category-travel",
  meals: "ff-badge-rejected",
  equipment: "ff-badge-draft",
  software: "ff-badge-funded",
  other: "ff-expenses-category-other",
};

const emptyForm = () => ({ id: undefined as number | undefined, title: "", description: "", amount: "", category: "other", expenseDate: new Date().toISOString().slice(0, 10), notes: "", receipt: null as File | null, status: "draft" });

function exportCsv(items: Expense[]) {
  const fields = ["id", "expenseDate", "title", "category", "description", "amount", "status", "submittedByName", "rejectionReason"];
  const csv = [fields, ...items.map((e) => fields.map((f) => String(e[f] ?? "").replaceAll('"', '""')))]
    .map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `Trucking_Pros_Financial_expenses-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

export default function Expenses() {
  const { user } = useAuth();
  const { toast } = useAdminToast();
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState<Expense | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [filters, setFilters] = useState({ category: "all", status: "all", agent: "all", from: "", to: "", page: 1 });
  const { category, status, agent, from, to, page } = filters;
  const setCategory = (category: string) => setFilters(f => ({ ...f, category, page: 1 }));
  const setStatus = (status: string) => setFilters(f => ({ ...f, status, page: 1 }));
  const setAgent = (agent: string) => setFilters(f => ({ ...f, agent, page: 1 }));
  const setFrom = (from: string) => setFilters(f => ({ ...f, from, page: 1 }));
  const setTo = (to: string) => setFilters(f => ({ ...f, to, page: 1 }));
  const setPage = (page: number) => setFilters(f => ({ ...f, page }));
  const isManager = user?.role === "manager" || user?.role === "admin";
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "15");
    if (category !== "all") params.set("category", category);
    if (status !== "all") params.set("status", status);
    if (agent !== "all" && isManager) params.set("userId", agent);
    if (from) params.set("dateFrom", from);
    if (to) params.set("dateTo", to);
    return `/api/expenses${params.toString() ? `?${params}` : ""}`;
  }, [category, status, agent, from, to, isManager, page]);
  const { data: raw, isLoading, isError, error } = useQuery<any>({ queryKey: [queryUrl] });
  useEffect(() => {
    if (typeof raw?.total !== "number") return;
    const lastPage = Math.max(1, Math.ceil(raw.total / 15));
    if (page > lastPage) setFilters(current => ({ ...current, page: lastPage }));
  }, [raw?.total, page]);
  const expenses = rows(raw);
  const agents: [string, string][] = (raw?.agents ?? []).map((agent: { id: string; name: string }) => [agent.id, agent.name]);
  const filtered = expenses;
  const summary = raw?.summary;
  const pageCount = Math.max(1, Math.ceil(Number(raw?.total ?? 0) / 15));
  const exportExpenses = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams(queryUrl.split("?")[1]);
      params.delete("page"); params.delete("pageSize"); params.set("all", "true");
      const response = await apiRequest("GET", `/api/expenses?${params}`);
      return rows(await response.json());
    },
    onSuccess: exportCsv,
    onError: (e: Error) => toast({ title: "Could not export expenses", description: e.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      if (form.id) {
        const fields = { title: form.title, description: form.description, amount: form.amount, category: form.category, expenseDate: form.expenseDate, notes: form.notes };
        await apiRequest("PATCH", `/api/expenses/${form.id}`, fields);
        if (form.receipt) {
          const upload = new FormData();
          upload.append("receipt", form.receipt);
          await apiRequest("POST", `/api/expenses/${form.id}/receipt`, upload);
        }
        if (submit) await apiRequest("PATCH", `/api/expenses/${form.id}`, { status: "submitted" });
        return;
      }
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key === "receipt" || key === "id" || key === "status") {
          if (value instanceof File) body.append("receipt", value);
        } else if (value !== "") {
          body.append(key, String(value));
        }
      });
      body.append("status", submit ? "submitted" : "draft");
      const response = await apiRequest("POST", "/api/expenses", body);
      return response.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/expenses") }); setOpen(false); setForm(emptyForm()); toast({ title: "Expense saved" }); },
    onError: (e: Error) => toast({ title: "Could not save expense", description: e.message, variant: "destructive" }),
  });
  const decision = useMutation({
    mutationFn: ({ id, approved, rejectReason }: { id: any; approved: boolean; rejectReason?: string }) =>
      approved ? apiRequest("PATCH", `/api/expenses/${id}/approve`) : apiRequest("PATCH", `/api/expenses/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => { queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/expenses") }); setRejecting(null); setReason(""); toast({ title: "Expense status updated" }); },
    onError: (e: Error) => toast({ title: "Could not update expense", description: e.message, variant: "destructive" }),
  });
  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "delete" | "resubmit" | "reimburse" }) => {
      if (action === "delete") return apiRequest("DELETE", `/api/expenses/${id}`);
      return apiRequest("PATCH", `/api/expenses/${id}`, { status: action === "resubmit" ? "submitted" : "reimbursed" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/expenses") });
      toast({ title: "Expense updated" });
    },
    onError: (e: Error) => toast({ title: "Could not update expense", description: e.message, variant: "destructive" }),
  });
  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const editExpense = (expense: Expense) => {
    setForm({
      id: Number(expense.id),
      title: expense.title || "",
      description: expense.description || "",
      amount: expense.amount || "",
      category: expense.category || "other",
      expenseDate: String(expense.expenseDate || "").slice(0, 10),
      notes: expense.notes || "",
      receipt: null,
      status: expense.status || "draft",
    });
    setOpen(true);
  };
  const categories = ["fuel", "office", "travel", "meals", "equipment", "software", "other"];

  return <div className="ff-expenses-page flex h-[100dvh] min-h-[100dvh] overflow-hidden bg-[#e0e0e0]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col"><TopNav title="Expenses" subtitle="Track, submit and approve business expenses" group="Admin" />
    <AdminPageShell className="flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-[1600px] space-y-5"><PageInsights entity="expenses" title="Expense activity" />
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Expenses</h1><p className="text-sm text-muted-foreground">Your expenses and the team approval queue</p></div><div className="flex gap-2"><Button variant="outline" disabled={exportExpenses.isPending} onClick={() => exportExpenses.mutate()}><Download className="mr-2 h-4 w-4" />Export CSV</Button><Button onClick={() => { setForm(emptyForm()); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />Add expense</Button></div></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="ff-expenses-surface ff-stat-card"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total This Month</CardTitle></CardHeader><CardContent className="ff-stat-value text-2xl">{summary ? money(summary.monthTotal) : "—"}</CardContent></Card>
        <Card className="ff-expenses-surface ff-stat-card"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Pending Approval</CardTitle></CardHeader><CardContent className="ff-stat-value text-2xl">{summary?.pending ?? "—"}</CardContent></Card>
        <Card className="ff-expenses-surface ff-stat-card"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Approved</CardTitle></CardHeader><CardContent className="ff-stat-value text-2xl">{summary ? money(summary.approvedTotal) : "—"}</CardContent></Card>
        <Card className="ff-expenses-surface ff-stat-card"><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Reimbursed</CardTitle></CardHeader><CardContent className="ff-stat-value text-2xl">{summary ? money(summary.reimbursedTotal) : "—"}</CardContent></Card>
      </div>
      <Card className="ff-expenses-surface"><CardContent className="flex flex-wrap items-center gap-2 pt-4"><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{[["draft", "Draft"], ["submitted", "Pending approval"], ["approved", "Approved"], ["rejected", "Rejected"], ["reimbursed", "Reimbursed"]].map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>{isManager && <Select value={agent} onValueChange={setAgent}><SelectTrigger className="w-[170px]"><SelectValue placeholder="Agent" /></SelectTrigger><SelectContent><SelectItem value="all">All agents</SelectItem>{agents.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select>}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" /><span className="text-sm text-muted-foreground">to</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" /></CardContent></Card>
        <Card className="ff-expenses-surface"><CardContent className="p-0"><div className="overflow-x-auto"><Table className="ff-data-table"><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Submitted by</TableHead><TableHead>Status</TableHead><TableHead>Receipt</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <TableRow><TableCell colSpan={8} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" />Loading expenses…</TableCell></TableRow> : isError ? <TableRow><TableCell colSpan={8} className="py-12 text-center text-destructive">Could not load expenses: {(error as Error)?.message}</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground">No expenses found.</TableCell></TableRow> : filtered.map((e) => { const canEdit = (e.status === "draft" || e.status === "rejected") && (isManager || String(e.submittedBy) === String(user?.id)); return <TableRow key={e.id}><TableCell>{date(e.expenseDate ?? e.createdAt)}</TableCell><TableCell><div className="font-medium">{e.title || "—"}</div>{e.description && <div className="max-w-[220px] truncate text-xs text-muted-foreground">{e.description}</div>}</TableCell><TableCell><Badge className={`ff-badge capitalize ${categoryClass[e.category] ?? categoryClass.other}`}>{e.category || "other"}</Badge></TableCell><TableCell className="text-right font-medium tabular-nums">{money(e.amount)}</TableCell><TableCell>{String(e.submittedBy) === String(user?.id) ? "You" : e.submittedByName || "—"}</TableCell><TableCell><Badge className={`ff-badge ${statusClass[e.status] ?? "ff-badge-draft"}`}>{statusLabel[e.status] || e.status || "Draft"}</Badge>{e.status === "rejected" && e.rejectionReason && <div className="mt-1 max-w-[180px] text-xs text-destructive">Reason: {e.rejectionReason}</div>}</TableCell><TableCell>{e.receiptUrl ? <a className="bevel-button inline-flex items-center gap-1 bg-[#d4d0c8] px-2 py-1 text-xs text-slate-700" href={e.receiptUrl} target="_blank" rel="noreferrer"><Receipt className="h-4 w-4" />View</a> : "—"}</TableCell><TableCell className="text-right"><span className="inline-flex flex-wrap justify-end gap-1">{canEdit && <Button size="sm" variant="outline" onClick={() => editExpense(e)}>Edit</Button>}{isManager && e.status === "submitted" && <><Button size="sm" className="ff-expenses-approve" onClick={() => decision.mutate({ id: e.id, approved: true })} title="Approve"><Check className="h-4 w-4" /></Button><Button size="sm" variant="destructive" className="ff-expenses-reject" onClick={() => setRejecting(e)} title="Reject"><X className="h-4 w-4" /></Button></>}{e.status === "draft" && <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ id: e.id, action: "delete" })}>Delete</Button>}{e.status === "rejected" && String(e.submittedBy) === String(user?.id) && <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ id: e.id, action: "resubmit" })}>Resubmit</Button>}{isManager && e.status === "approved" && <Button size="sm" variant="outline" onClick={() => lifecycle.mutate({ id: e.id, action: "reimburse" })}>Mark reimbursed</Button>}</span></TableCell></TableRow>; })}</TableBody></Table></div></CardContent></Card>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{raw?.total ?? 0} expenses · Page {page} of {pageCount}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1 || isLoading} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" disabled={page >= pageCount || isLoading} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div></AdminPageShell></div>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="ff-expenses-surface max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{form.id ? "Edit expense" : "Add expense"}</DialogTitle></DialogHeader><form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!form.title || !form.amount) { toast({ title: "Title and amount are required", variant: "destructive" }); return; } save.mutate(true); }}><div className="sm:col-span-2"><Label>Title *</Label><Input required value={form.title} onChange={(e) => set("title", e.target.value)} /></div><div><Label>Amount *</Label><Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></div><div><Label>Expense Date *</Label><Input required type="date" value={form.expenseDate} onChange={(e) => set("expenseDate", e.target.value)} /></div><div><Label>Category *</Label><Select value={form.category} onValueChange={(v) => set("category", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{categories.map((v) => <SelectItem key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</SelectItem>)}</SelectContent></Select></div><div className="ff-expenses-upload ff-expenses-surface"><Label className="flex items-center gap-2"><Receipt className="h-4 w-4" />Receipt (image or PDF)</Label><Input type="file" accept="image/*,.pdf,application/pdf" onChange={(e) => set("receipt", e.target.files?.[0] || null)} /></div><div className="sm:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} /></div><div className="sm:col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending}>{form.id ? "Save changes" : "Save draft"}</Button><Button type="submit" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{form.id ? "Submit for approval" : "Submit for approval"}</Button></div></form></DialogContent></Dialog>
     <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}><DialogContent className="ff-expenses-surface"><DialogHeader><DialogTitle>Reject expense</DialogTitle></DialogHeader><Label>Reason for rejection *</Label><Textarea className="ff-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain what needs to be corrected…" /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="destructive" disabled={!reason.trim() || decision.isPending || !rejecting} onClick={() => rejecting && decision.mutate({ id: rejecting.id, approved: false, rejectReason: reason })}>Reject expense</Button></div></DialogContent></Dialog>
  </div>;
}
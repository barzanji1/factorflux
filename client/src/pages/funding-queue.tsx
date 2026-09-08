import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, FileText, Search, Square, SquareCheck, X } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FFBadge } from "@/components/ui/ff-badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { Invoice } from "@shared/schema";

type FundingQueueInvoice = Invoice & {
  carrierName?: string | null;
  brokerName?: string | null;
  advanceRate?: string | null;
  factoringFeeRate?: string | null;
  displayStatus?: string;
  documentPresence: {
    rateConfirmation: boolean;
    billOfLading: boolean;
    readyToFund: boolean;
  };
};
const age = (value?: string | Date | null) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : null;
const money = (value: string | number) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FundingQueue() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [fundOpen, setFundOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"ach" | "wire">("ach");
  const [bankAccountId, setBankAccountId] = useState("");

  const { data: invoices = [], isLoading, isError } = useQuery<FundingQueueInvoice[]>({ queryKey: ["/api/invoices/funding/queue"] });
  const rows = useMemo(() => invoices.filter(i =>
    !search || `${i.invoiceNumber} ${i.carrierName ?? ""} ${i.brokerName ?? ""}`.toLowerCase().includes(search.toLowerCase())
  ), [invoices, search]);
  const selectedRow = selected.size === 1 ? rows.find(row => selected.has(row.id)) : undefined;
  const { data: selectedAccounts = [] } = useQuery<any[]>({
    queryKey: [`/api/carriers/${selectedRow?.clientId}/bank-accounts`],
    enabled: fundOpen && !!selectedRow?.clientId,
  });
  useEffect(() => {
    if (fundOpen && selected.size === 1 && selectedAccounts.length && !bankAccountId) {
      setBankAccountId(String(selectedAccounts[0].id));
    }
  }, [fundOpen, selected.size, selectedAccounts, bankAccountId]);

  const transition = useMutation({
    mutationFn: async ({ id, transitionId, rejectReason }: { id: number; transitionId: string; rejectReason?: string }) => {
      const response = await apiRequest("POST", `/api/invoices/${id}/transition`, { transitionId, reason: rejectReason, force: false });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message ?? body.error ?? "Action failed");
      return body;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/invoices"] }),
    onError: (error: Error) => toast({ title: "Action failed", description: error.message, variant: "destructive" }),
  });

  const toggle = (id: number) => setSelected(current => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map(row => row.id)));
  const reject = () => {
    if (!rejectId || reason.trim().length < 3) return;
    transition.mutate({ id: rejectId, transitionId: "reject", rejectReason: reason.trim() }, { onSuccess: () => { setRejectId(null); setReason(""); } });
  };
  const approve = async () => {
    const ids = Array.from(selected);
    try {
      const items = [];
      for (const id of ids) {
        const detailResponse = await fetch(`/api/invoices/${id}/detail`, { credentials: "include" });
        if (!detailResponse.ok) throw new Error("Could not load invoice funding details");
        const detail = await detailResponse.json();
        const carrierId = detail.client?.id ?? detail.clientId;
        const accountsResponse = await fetch(`/api/carriers/${carrierId}/bank-accounts`, { credentials: "include" });
        const accounts = accountsResponse.ok ? await accountsResponse.json() : [];
        if (!accounts.length) throw new Error(`No bank account is configured for ${detail.client?.name ?? "this carrier"}`);
        const selectedAccount = ids.length === 1 && bankAccountId
          ? accounts.find((account: any) => String(account.id) === bankAccountId)
          : accounts[0];
        if (!selectedAccount) throw new Error("Select a valid carrier bank account");
        items.push({ invoiceId: id, paymentMethod, bankAccountVaultId: selectedAccount.id });
      }
      const response = await apiRequest("POST", "/api/invoices/funding/batch", { items, force: false });
      const body = await response.json();
      if (!response.ok || !body.success) {
        const firstFailure = body.results?.find((result: any) => !result.success);
        throw new Error(firstFailure?.error ?? body.message ?? "One or more invoices could not be funded");
      }
      await qc.invalidateQueries({ queryKey: ["/api/invoices/funding/queue"] });
      await qc.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: `${ids.length} invoice${ids.length === 1 ? "" : "s"} approved and funded` });
      setSelected(new Set()); setFundOpen(false);
    } catch (error) {
      toast({ title: "Funding failed", description: error instanceof Error ? error.message : "Unable to fund the selected invoices", variant: "destructive" });
    }
  };

  if (user?.role !== "manager" && user?.role !== "admin") {
    navigate("/invoices");
    return null;
  }

  return <div className="flex min-h-[100dvh] bg-[hsl(var(--background))]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col">
    <TopNav title="Funding Queue" subtitle="Review invoices ready for a funding decision" group="Funding" />
    <main className="custom-scrollbar flex-1 overflow-auto"><div className="mx-auto w-full max-w-[1500px] space-y-5 p-5 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Manager workspace</p><h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">Pending review</h1><p className="mt-1 text-sm text-slate-500">Only submitted invoices appear here. Open a row to review its documents.</p></div>
        <div className="relative w-full md:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Search funding queue" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice or load" className="pl-9" /></div>
      </div>
      {selected.size > 0 && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"><span className="font-semibold">{selected.size} selected</span><Button size="sm" onClick={() => setFundOpen(true)}>Approve &amp; Fund</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div>}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        {isLoading ? <div className="space-y-3 p-6"><div className="h-10 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /><div className="h-10 animate-pulse rounded bg-slate-100" /></div> : isError ? <div className="p-12 text-center text-sm text-red-600">Unable to load the funding queue.</div> : rows.length === 0 ? <div className="p-16 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" /><p className="font-semibold text-slate-700 dark:text-slate-200">No invoices pending review</p><p className="mt-1 text-sm text-slate-500">New submissions will appear here when available.</p></div> :
           <div className="overflow-x-auto"><table className="ff-data-table min-w-[1180px]"><thead><tr><th className="w-10 pl-5"><button aria-label="Select all" onClick={toggleAll}>{selected.size === rows.length ? <SquareCheck className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4" />}</button></th><th>Invoice</th><th>Carrier</th><th>Broker</th><th>Amount</th><th>Submitted</th><th>Documents</th><th>Age</th><th>Status</th><th className="pr-5">Actions</th></tr></thead>
              <tbody>{rows.map(invoice => <tr key={invoice.id}><td className="pl-5"><button aria-label={`Select ${invoice.invoiceNumber}`} onClick={() => toggle(invoice.id)}>{selected.has(invoice.id) ? <SquareCheck className="h-4 w-4 text-blue-600" /> : <Square className="h-4 w-4 text-slate-400" />}</button></td><td><button className="font-mono font-semibold text-blue-700 hover:underline" onClick={() => navigate(`/invoices/${invoice.id}`)}>{invoice.invoiceNumber}</button></td><td>{invoice.carrierName ?? "—"}</td><td>{invoice.brokerName ?? "—"}</td><td className="font-semibold">{money(invoice.amount)}</td><td className="text-xs">{invoice.submittedAt ? new Date(invoice.submittedAt).toLocaleDateString() : "—"}</td><td><div className="space-y-1 text-xs"><p className={invoice.documentPresence.rateConfirmation ? "text-emerald-700" : "text-red-600"}>Rate Con {invoice.documentPresence.rateConfirmation ? "✓" : "✕"}</p><p className={invoice.documentPresence.billOfLading ? "text-emerald-700" : "text-red-600"}>BOL {invoice.documentPresence.billOfLading ? "✓" : "✕"}</p></div></td><td className="font-mono text-xs">{age(invoice.submittedAt)}d</td><td><FFBadge status={invoice.status} size="sm" /></td><td className="pr-5"><div className="flex gap-2"><Button size="sm" disabled={!invoice.documentPresence.readyToFund} onClick={() => { setSelected(new Set([invoice.id])); setFundOpen(true); }}>Approve &amp; Fund</Button><Button size="sm" variant="outline" onClick={() => navigate(`/invoices/${invoice.id}`)}>Review</Button><Button size="sm" variant="ghost" aria-label={`Reject ${invoice.invoiceNumber}`} onClick={() => setRejectId(invoice.id)}><X className="h-4 w-4" /></Button></div></td></tr>)}</tbody>
          </table></div>}
      </section>
    </div></main>
    <Dialog open={rejectId !== null} onOpenChange={open => !open && setRejectId(null)}><DialogContent><DialogHeader><DialogTitle>Reject invoice</DialogTitle></DialogHeader><Textarea autoFocus aria-label="Rejection reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Required reason for rejection" /><DialogFooter><Button variant="outline" onClick={() => setRejectId(null)}>Cancel</Button><Button variant="destructive" disabled={reason.trim().length < 3 || transition.isPending} onClick={reject}>Reject</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={fundOpen} onOpenChange={open => { setFundOpen(open); if (!open) setBankAccountId(""); }}><DialogContent><DialogHeader><DialogTitle>Approve &amp; Fund {selected.size} invoice{selected.size === 1 ? "" : "s"}</DialogTitle></DialogHeader>
      <p className="text-sm text-slate-500">This confirms approval and creates the carrier payout in one action.</p>
      {selectedRow && <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900"><div><span className="text-slate-500">Advance rate</span><p className="font-semibold">{selectedRow.advanceRate ?? "80.00"}%</p></div><div><span className="text-slate-500">Factoring fee</span><p className="font-semibold">{selectedRow.factoringFeeRate ?? "3.00"}%</p></div><div><span className="text-slate-500">Invoice amount</span><p className="font-semibold">{money(selectedRow.amount)}</p></div><div><span className="text-slate-500">Net advance</span><p className="font-semibold">{money(Number(selectedRow.amount) * (Number(selectedRow.advanceRate ?? 80) - Number(selectedRow.factoringFeeRate ?? 3)) / 100)}</p></div></div>}
      <label className="text-sm font-medium">Payment method<select aria-label="Payment method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as "ach" | "wire")} className="mt-1 w-full rounded-md border bg-background p-2"><option value="ach">ACH</option><option value="wire">Wire</option></select></label>
      {selectedRow ? <label className="text-sm font-medium">Bank account<select aria-label="Bank account" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} className="mt-1 w-full rounded-md border bg-background p-2"><option value="">Select bank account</option>{selectedAccounts.map((account: any) => <option key={account.id} value={String(account.id)}>{account.bankName ?? account.label ?? "Bank account"} ending in {account.lastFour ?? "••••"}</option>)}</select></label> : <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">Batch funding uses each carrier’s primary active bank account and configured advance and fee rates.</p>}
      <DialogFooter><Button variant="outline" onClick={() => setFundOpen(false)}>Cancel</Button><Button onClick={approve} disabled={transition.isPending || (selected.size === 1 && !bankAccountId)}><Check className="mr-2 h-4 w-4" />Confirm Funding</Button></DialogFooter>
    </DialogContent></Dialog>
  </div></div>;
}
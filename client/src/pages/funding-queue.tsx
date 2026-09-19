import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, Download, FileText, Loader2, Search, X } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FFBadge } from "@/components/ui/ff-badge";
import { LoadTypeBadge } from "@/components/load-type";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

type QueueRow = {
  id: number;
  invoiceNumber: string;
  loadNumber?: string | null;
  code?: string | null;
  amount: string;
  status: string;
  displayStatus?: string;
  clientId: number;
  branchName?: string | null;
  carrierName?: string | null;
  brokerName?: string | null;
  driverName?: string | null;
  submittedByName?: string | null;
  submittedAt?: string | null;
  loadType?: string | null;
  paymentType?: string | null;
  bankAccountId?: number | null;
  bankAccount?: { id: number; bankName: string; lastFour: string; paymentType?: string | null; isActive?: boolean } | null;
  instructionsSubject?: string | null;
  instructionsDetails?: string | null;
  documentPresence: { rateConfirmation: boolean; billOfLading: boolean; lumper: boolean; readyToFund: boolean };
  documents: Array<{ id: number; type: string; originalName: string; size: number; viewPath: string; downloadPath: string }>;
  payoutPreview: { grossAmount: string; advanceRate: string; advanceAmount: string; feeRate: string; feeAmount: string; reserveAmount: string; netFundingAmount: string };
};

const money = (value: string | number) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "—";
const statusLabel = (row: QueueRow) => row.displayStatus || row.status;
const SHEETS_REVIEW_STATUSES = ["submitted", "docs_pending", "under_review", "approved"];

function cutoffState() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const cutoffs = [{ label: "ACH", time: "2:15 PM MST", minutes: 14 * 60 + 15 }, { label: "Wire", time: "1:15 PM MST", minutes: 13 * 60 + 15 }];
  return cutoffs.map((cutoff) => {
    const difference = cutoff.minutes - current;
    return { ...cutoff, difference, imminent: difference >= 0 && difference <= 30, passed: difference < 0 };
  });
}

function cutoffText(minutes: number) {
  if (minutes < 0) return "Cutoff passed";
  if (minutes === 0) return "Cutoff now";
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60}m remaining`;
}

export default function FundingQueue() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("actionable");
  const [paymentType, setPaymentType] = useState("all");
  const [carrierId, setCarrierId] = useState("all");
  const [brokerId, setBrokerId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reasonModal, setReasonModal] = useState<{ id: number; action: "reject" | "hold" } | null>(null);
  const [reason, setReason] = useState("");
  const [fundRows, setFundRows] = useState<QueueRow[]>([]);
  const [fundOpen, setFundOpen] = useState(false);
  const [funding, setFunding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cutoffs, setCutoffs] = useState(cutoffState);

  useEffect(() => {
    const timer = window.setInterval(() => setCutoffs(cutoffState()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) params.set("q", search.trim());
    if (status !== "actionable") params.set("status", status);
    if (tab !== "all") params.set("loadType", tab);
    if (paymentType !== "all") params.set("paymentType", paymentType);
    if (carrierId !== "all") params.set("carrierId", carrierId);
    if (brokerId !== "all") params.set("brokerId", brokerId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return `/api/invoices/funding/queue?${params.toString()}`;
  }, [search, status, tab, paymentType, carrierId, brokerId, dateFrom, dateTo, page]);
  const { data, isLoading, isError } = useQuery<{ rows: QueueRow[]; total: number }>({
    queryKey: [queryUrl],
    queryFn: async () => {
      const response = await fetch(queryUrl, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).message || "Unable to load Sheets");
      return response.json();
    },
  });
  const rows = (data?.rows ?? []).filter((row) => SHEETS_REVIEW_STATUSES.includes(row.status));
  const { data: carrierResponse } = useQuery<Array<{ id: number; name: string }> | { data: Array<{ id: number; name: string }> }>({ queryKey: ["/api/clients?all=true"] });
  const { data: brokerResponse } = useQuery<Array<{ id: number; name: string }> | { data: Array<{ id: number; name: string }> }>({ queryKey: ["/api/brokers?all=true"] });
  const carriers = Array.isArray(carrierResponse) ? carrierResponse : carrierResponse?.data ?? [];
  const brokers = Array.isArray(brokerResponse) ? brokerResponse : brokerResponse?.data ?? [];
  const actionableRows = rows.filter((row) => row.status === "approved" && row.documentPresence.readyToFund && !!row.bankAccount?.isActive);
  const selectedRows = rows.filter((row) => selected.has(row.id) && row.status === "approved" && row.documentPresence.readyToFund && !!row.bankAccount?.isActive);

  useEffect(() => {
    setSelected((current) => new Set(Array.from(current).filter((id) => actionableRows.some((row) => row.id === id))));
  }, [queryUrl, data]); // Clear stale/invalid selections whenever the server view changes.
  useEffect(() => {
    setPage(1);
  }, [search, status, tab, paymentType, carrierId, brokerId, dateFrom, dateTo]);

  if (user?.role !== "manager" && user?.role !== "admin") {
    navigate("/invoices");
    return null;
  }

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [queryUrl] });
    await queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
  };
  const transition = async (id: number, transitionId: string, transitionReason?: string) => {
    const response = await apiRequest("POST", `/api/invoices/${id}/transition`, { transitionId, reason: transitionReason, force: false });
    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.message || body.error || body.blockers?.map((item: any) => item.message).join(", ") || "Action failed");
    return body;
  };
  const approve = async (row: QueueRow) => {
    try {
      if (row.status !== "under_review") await transition(row.id, "start_review");
      await transition(row.id, "approve");
      toast({ title: "Invoice approved", description: `${row.invoiceNumber} is ready for funding.` });
      await refresh();
    } catch (error) {
      toast({ title: "Could not approve invoice", description: error instanceof Error ? error.message : "Action failed", variant: "destructive" });
    }
  };
  const submitReason = async () => {
    if (!reasonModal || reason.trim().length < 3) return;
    try {
      if (reasonModal.action === "hold") {
        const response = await apiRequest("POST", `/api/invoices/${reasonModal.id}/hold`, { reason: reason.trim() });
        if (!response.ok) throw new Error((await response.json()).message || "Could not place invoice on hold");
      } else {
        await transition(reasonModal.id, "reject", reason.trim());
      }
      setReasonModal(null); setReason("");
      await refresh();
    } catch (error) {
      toast({ title: "Action failed", description: error instanceof Error ? error.message : "Action failed", variant: "destructive" });
    }
  };
  const openFunding = (items: QueueRow[]) => {
    if (!items.length || items.some((item) => !item.bankAccount?.id)) {
      toast({ title: "Bank account required", description: "Each invoice must have an active selected bank account before funding.", variant: "destructive" });
      return;
    }
    setFundRows(items); setFundOpen(true);
  };
  const fund = async () => {
    if (funding || !fundRows.length) return;
    setFunding(true);
    try {
      const response = await apiRequest("POST", "/api/invoices/funding/batch", {
        items: fundRows.map((row) => ({ invoiceId: row.id, bankAccountVaultId: row.bankAccount!.id, paymentMethod: row.paymentType === "Wire" ? "wire" : "ach" })),
        force: false,
      });
      const body = await response.json();
      const failures = body.results?.filter((result: any) => !result.success) ?? [];
      if (!response.ok && !body.results) throw new Error(body.message || "Funding failed");
      if (failures.length) {
        toast({ title: `${body.funded ?? 0} funded, ${failures.length} failed`, description: failures.map((result: any) => `${result.invoiceId}: ${result.error || "failed"}`).join("; "), variant: "destructive" });
      } else toast({ title: `${fundRows.length} invoice${fundRows.length === 1 ? "" : "s"} funded` });
      setFundOpen(false); setFundRows([]); setSelected(new Set()); await refresh();
    } catch (error) {
      toast({ title: "Funding failed", description: error instanceof Error ? error.message : "Unable to fund invoices", variant: "destructive" });
    } finally { setFunding(false); }
  };
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const firstUrl = new URL(queryUrl, window.location.origin);
      firstUrl.searchParams.set("page", "1");
      firstUrl.searchParams.set("pageSize", "100");
      const allRows: QueueRow[] = [];
      let exportPage = 1;
      let total = 0;
      do {
        firstUrl.searchParams.set("page", String(exportPage));
        const response = await fetch(firstUrl.toString(), { credentials: "include" });
        if (!response.ok) throw new Error((await response.json()).message || "Unable to export Sheets");
        const body = await response.json() as { rows: QueueRow[]; total: number };
        allRows.push(...(body.rows ?? []));
        total = Number(body.total ?? allRows.length);
        exportPage += 1;
        if (!body.rows?.length) break;
      } while (allRows.length < total);
    const fields = ["Carrier", "Broker", "Branch", "Load#", "Code", "Amount $", "Load Type", "Payment Type", "Bank Account", "Driver", "Rate Con", "BOL", "Lumper", "Submitted by", "Date"];
    const csvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
    const values = allRows.map((row) => [row.carrierName, row.brokerName, row.branchName, row.loadNumber, row.code, row.amount, row.loadType, row.paymentType, row.bankAccount ? `${row.bankAccount.bankName} ending ${row.bankAccount.lastFour}` : "", row.driverName, row.documentPresence.rateConfirmation ? "Yes" : "No", row.documentPresence.billOfLading ? "Yes" : "No", row.documentPresence.lumper ? "Yes" : "No", row.submittedByName, dateLabel(row.submittedAt)]);
    const blob = new Blob([[fields, ...values].map((line) => line.map(csvValue).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `sheets-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Unable to export Sheets", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };
  const toggleRow = (row: QueueRow) => {
    if (row.status !== "approved" || !row.documentPresence.readyToFund || !row.bankAccount?.isActive) return;
    setSelected((current) => { const next = new Set(current); next.has(row.id) ? next.delete(row.id) : next.add(row.id); return next; });
  };

  return <div className="ff-sheets-page flex min-h-[100dvh] bg-[#d4d0c8]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col">
    <TopNav title="Sheets" subtitle="Review and fund submitted invoices" group="Funding" />
    <main className="custom-scrollbar flex-1 overflow-auto"><div className="mx-auto w-full max-w-[1600px] space-y-5 p-5 md:p-8">
      <section className={`ff-card ff-sheets-surface border px-5 py-4 ${cutoffs.some((item) => item.imminent) ? "border-red-300 bg-red-50 text-red-900" : "border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-[hsl(var(--card))] dark:text-white"}`} aria-label="Funding cutoff times">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em]">Funding cutoff</p><p className="mt-1 text-sm">ACH <strong>2:15 PM MST</strong> · Wire <strong>1:15 PM MST</strong> <span className="text-xs opacity-70">(Denver time, daylight changes handled)</span></p></div><div className="flex gap-3 text-xs font-semibold">{cutoffs.map((item) => <span key={item.label} className="ff-dashboard-card ff-sheets-surface px-3 py-2">{item.label}: {cutoffText(item.difference)}</span>)}</div></div>
      </section>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Manager workspace</p><h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">Sheets</h1><p className="mt-1 text-sm text-slate-500">Actionable pending-review and approved invoices.</p></div><div className="flex gap-2"><Button variant="outline" onClick={exportCsv} disabled={exporting}><Download className="mr-2 h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button>{selectedRows.length > 0 && <Button onClick={() => openFunding(selectedRows)}>Fund Selected ({selectedRows.length})</Button>}</div></div>
      <div className="flex flex-wrap gap-2">{[["all", "All"], ["otr_load", "OTR"], ["dump_truck_ticket", "Dump"], ["hotshot", "Hotshot"], ["other", "Other"]].map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${tab === value ? "border-[#087d8d] bg-[#087d8d] text-white shadow-[1px_1px_0_#808080]" : "border-[#808080] bg-[#d4d0c8] text-[#444] shadow-[1px_1px_0_#808080]"}`}>{label}</button>)}</div>
      <section className="ff-card ff-sheets-surface grid gap-3 border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[hsl(var(--card))] md:grid-cols-3 lg:grid-cols-6">
        <div className="relative lg:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Search Sheets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search load, invoice, carrier" className="pl-9" /></div>
        <select aria-label="Actionable status" value={status} onChange={(event) => setStatus(event.target.value)} className="ff-input border bg-background px-3 text-sm"><option value="actionable">Pending Review + Approved</option><option value="submitted,docs_pending,under_review">Pending Review</option><option value="approved">Approved</option></select>
        <select aria-label="Carrier" value={carrierId} onChange={(event) => setCarrierId(event.target.value)} className="ff-input border bg-background px-3 text-sm"><option value="all">All carriers</option>{carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}</select>
        <select aria-label="Broker" value={brokerId} onChange={(event) => setBrokerId(event.target.value)} className="ff-input border bg-background px-3 text-sm"><option value="all">All brokers</option>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name}</option>)}</select>
        <select aria-label="Payment type" value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className="ff-input border bg-background px-3 text-sm"><option value="all">All payment types</option><option value="ACH">ACH</option><option value="Wire">Wire</option></select>
        <div className="flex gap-2 lg:col-span-2"><Input aria-label="Date from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><Input aria-label="Date to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
      </section>
      <section className="ff-card ff-table-container ff-sheets-surface overflow-hidden border border-slate-200 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        {isLoading ? <div className="flex items-center justify-center gap-2 p-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Loading Sheets…</div> : isError ? <div className="p-16 text-center text-sm text-red-600">Unable to load Sheets. Check your filters and try again.</div> : !rows.length ? <div className="p-16 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" /><p className="font-semibold text-slate-700 dark:text-slate-200">No invoices match these filters</p><p className="mt-1 text-sm text-slate-500">New submissions will appear here when available.</p></div> :
            <div className="overflow-x-auto"><table className="ff-data-table min-w-[1550px]"><thead><tr><th className="w-10 pl-5"><Checkbox aria-label="Select all ready approved invoices" checked={actionableRows.length > 0 && selectedRows.length === actionableRows.length} onCheckedChange={() => setSelected(selectedRows.length === actionableRows.length ? new Set() : new Set(actionableRows.map((row) => row.id)))} /></th><th>Carrier</th><th>Broker</th><th>Branch</th><th>Load#</th><th>Code</th><th>Amount $</th><th>Load Type</th><th>Payment Type</th><th>Bank Account</th><th>Driver</th><th>Rate Con</th><th>BOL</th><th>Lumper</th><th>Submitted by</th><th>Date</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <Fragment key={row.id}><tr className="cursor-pointer" onClick={() => setExpanded(expanded === row.id ? null : row.id)}><td className="pl-5" onClick={(event) => event.stopPropagation()}><Checkbox disabled={row.status !== "approved" || !row.documentPresence.readyToFund || !row.bankAccount?.isActive} aria-label={`Select ${row.invoiceNumber}`} checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row)} /></td><td className="font-semibold">{row.carrierName || "—"}</td><td>{row.brokerName || "—"}</td><td>{row.branchName || "—"}</td><td className="font-mono font-semibold">{row.loadNumber || row.invoiceNumber}</td><td>{row.code || "—"}</td><td className="font-semibold">{money(row.amount)}</td><td><LoadTypeBadge value={row.loadType} /></td><td>{row.paymentType || "—"}</td><td>{row.bankAccount ? `${row.bankAccount.bankName} ••••${row.bankAccount.lastFour}` : <span className="text-red-600">Missing</span>}</td><td>{row.driverName || "—"}</td><td className={row.documentPresence.rateConfirmation ? "text-emerald-700" : "text-red-600"}>{row.documentPresence.rateConfirmation ? "✓" : "✕"}</td><td className={row.documentPresence.billOfLading ? "text-emerald-700" : "text-red-600"}>{row.documentPresence.billOfLading ? "✓" : "✕"}</td><td className={row.documentPresence.lumper ? "text-emerald-700" : "text-slate-400"}>{row.documentPresence.lumper ? "✓" : "—"}</td><td>{row.submittedByName || "—"}</td><td>{dateLabel(row.submittedAt)}</td><td onClick={(event) => event.stopPropagation()}><div className="flex flex-wrap items-center gap-1"><FFBadge status={row.status} size="sm" />{row.status === "approved" ? <Button size="sm" disabled={!row.documentPresence.readyToFund || !row.bankAccount?.isActive} onClick={() => openFunding([row])}>Fund</Button> : <Button size="sm" disabled={!row.documentPresence.rateConfirmation || !row.documentPresence.billOfLading} onClick={() => approve(row)}>Approve</Button>}<Button size="sm" variant="outline" onClick={() => setReasonModal({ id: row.id, action: "hold" })}>Hold</Button>{row.status !== "approved" && <Button size="sm" variant="destructive" aria-label={`Reject ${row.invoiceNumber}`} onClick={() => setReasonModal({ id: row.id, action: "reject" })}><X className="h-4 w-4" /></Button>}</div></td></tr>{expanded === row.id && <tr key={`${row.id}-detail`}><td colSpan={17} className="bg-slate-50 p-5 dark:bg-slate-950"><div className="ff-card ff-sheets-surface grid gap-5 p-4 lg:grid-cols-3"><div><p className="text-xs font-bold uppercase text-slate-500">Invoice details</p><p className="mt-2 text-sm">Invoice <strong>{row.invoiceNumber}</strong> · Load {row.loadNumber || "—"} · Code {row.code || "—"}</p><p className="text-sm">Payment: {row.paymentType || "—"} · Status: {statusLabel(row)}</p>{row.instructionsSubject && <p className="mt-3 text-sm font-semibold">{row.instructionsSubject}</p>}{row.instructionsDetails && <p className="whitespace-pre-wrap text-sm text-slate-600">{row.instructionsDetails}</p>}</div><div><p className="text-xs font-bold uppercase text-slate-500">Payout preview</p><dl className="mt-2 grid grid-cols-2 gap-2 text-sm"><dt>Gross</dt><dd className="text-right font-semibold">{money(row.payoutPreview.grossAmount)}</dd><dt>Advance ({row.payoutPreview.advanceRate}%)</dt><dd className="text-right">{money(row.payoutPreview.advanceAmount)}</dd><dt>Fee ({row.payoutPreview.feeRate}%)</dt><dd className="text-right">{money(row.payoutPreview.feeAmount)}</dd><dt>Reserve</dt><dd className="text-right">{money(row.payoutPreview.reserveAmount)}</dd><dt className="font-semibold">Net funding</dt><dd className="text-right font-semibold">{money(row.payoutPreview.netFundingAmount)}</dd></dl></div><div><p className="text-xs font-bold uppercase text-slate-500">Documents</p><div className="mt-2 space-y-2">{[{ label: "Rate Con", types: ["rate_confirmation"] }, { label: "BOL", types: ["bill_of_lading", "bol"] }, { label: "Lumper", types: ["lumper_receipt", "receipt"] }].map(({ label, types }) => { const doc = row.documents.find((item) => types.includes(item.type)); return <div key={label} className="ff-sheets-surface flex items-center justify-between border bg-white p-2 text-sm"><span className={doc ? "text-emerald-700" : "text-red-600"}>{doc ? "✓" : "✕"} {label}</span>{doc && <span className="flex gap-2"><a className="text-blue-700 hover:underline" href={doc.viewPath} target="_blank" rel="noreferrer">View</a><a className="text-blue-700 hover:underline" href={doc.downloadPath} target="_blank" rel="noreferrer">Download</a></span>}</div>; })}</div></div></div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={() => navigate(`/invoices/${row.id}`)}>Open invoice</Button></div></td></tr>}</Fragment>)}</tbody></table></div>}
      </section>
      <div className="flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between" aria-label="Sheets pagination">
        <span>{data?.total ?? 0} invoice{data?.total === 1 ? "" : "s"} · Page {page} of {Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil((data?.total ?? 0) / pageSize) || isLoading} onClick={() => setPage((current) => current + 1)}>Next</Button>
        </div>
      </div>
    </div></main>
    <Dialog open={reasonModal !== null} onOpenChange={(open) => { if (!open) setReasonModal(null); }}><DialogContent className="ff-sheets-surface"><DialogHeader><DialogTitle>{reasonModal?.action === "hold" ? "Hold invoice" : "Reject invoice"}</DialogTitle><DialogDescription>A reason is required and will be recorded in the invoice lifecycle history.</DialogDescription></DialogHeader><Textarea autoFocus aria-label="Required reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Enter at least 3 characters" /><DialogFooter><Button variant="outline" onClick={() => setReasonModal(null)}>Cancel</Button><Button variant={reasonModal?.action === "reject" ? "destructive" : "default"} disabled={reason.trim().length < 3} onClick={submitReason}>{reasonModal?.action === "hold" ? "Place on hold" : "Reject"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={fundOpen} onOpenChange={(open) => { if (!open && !funding) setFundOpen(false); }}><DialogContent className="ff-sheets-surface"><DialogHeader><DialogTitle>Fund selected invoice{fundRows.length === 1 ? "" : "s"}</DialogTitle><DialogDescription>Funding calculations, payout creation, email, and status transitions are completed by the lifecycle service.</DialogDescription></DialogHeader><div className="max-h-64 space-y-2 overflow-auto">{fundRows.map((row) => <div key={row.id} className="ff-sheets-surface flex justify-between bg-slate-50 p-3 text-sm dark:bg-slate-900"><span>{row.invoiceNumber} · {row.paymentType === "Wire" ? "Wire" : "ACH"} · {row.bankAccount?.bankName} ••••{row.bankAccount?.lastFour}</span><strong>{money(row.payoutPreview.netFundingAmount)}</strong></div>)}</div><div className="ff-sheets-surface grid grid-cols-2 gap-3 border p-3 text-sm"><span>Total invoice amount</span><strong className="text-right">{money(fundRows.reduce((sum, row) => sum + Number(row.amount), 0))}</strong><span>Total estimated net funding</span><strong className="text-right">{money(fundRows.reduce((sum, row) => sum + Number(row.payoutPreview.netFundingAmount), 0))}</strong></div><DialogFooter><Button variant="outline" onClick={() => setFundOpen(false)} disabled={funding}>Cancel</Button><Button onClick={fund} disabled={funding}>{funding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm funding</Button></DialogFooter></DialogContent></Dialog>
  </div></div>;
}
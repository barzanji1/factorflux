import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FFEmpty } from "@/components/ui/ff-empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus,
  Search,
  ArrowRightLeft,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  Banknote,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type CashApplication = {
  id: number;
  paymentReference: string;
  payorName: string;
  debtorId?: number | null;
  paymentDate: string;
  totalReceived: string;
  paymentMethod: "ach" | "wire" | "check" | "other";
  status: "unapplied" | "partially_applied" | "fully_applied" | "overpaid";
  notes?: string | null;
  processedBy?: string | null;
  createdAt: string;
  lines?: PaymentLine[];
};

type PaymentLine = {
  id: number;
  cashApplicationId: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceAmount: string;
  appliedAmount: string;
  variance: string | null;
  varianceType: "full_match" | "short_pay" | "overpay" | "write_off";
  varianceReason: string | null;
};

type Invoice = {
  id: number;
  invoiceNumber: string;
  amount: string;
  status: string;
  clientId: number;
};

type Debtor = { id: number; name: string; };

const VARIANCE_STYLE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  full_match: { label: "Full Match", color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  short_pay:  { label: "Short Pay",  color: "text-red-600 dark:text-red-400",         icon: TrendingDown },
  overpay:    { label: "Overpay",    color: "text-purple-600 dark:text-purple-400",    icon: TrendingUp   },
  write_off:  { label: "Write-off",  color: "text-slate-500 dark:text-slate-400",      icon: XCircle      },
};

function fmtMoney(v: string | number | null | undefined) {
  if (v == null || v === "") return "—";
  return `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function paymentAgeDays(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function AgePill({ dateStr }: { dateStr: string }) {
  const d = paymentAgeDays(dateStr);
  if (d === 0) return <span className="text-[11px] text-slate-400">Today</span>;
  if (d <= 2)  return <span className="text-[11px] text-slate-500">{d}d</span>;
  if (d <= 5)  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3" />{d}d
    </span>
  );
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
      <AlertTriangle className="h-3 w-3" />{d}d
    </span>
  );
}

function StatusBadge({ status }: { status: CashApplication["status"] }) {
  const map: Record<CashApplication["status"], string> = {
    unapplied:         "ff-badge ff-badge-pending",
    partially_applied: "ff-badge ff-badge-partial",
    fully_applied:     "ff-badge ff-badge-funded",
    overpaid:          "ff-badge ff-badge-hold",
  };
  const labels: Record<CashApplication["status"], string> = {
    unapplied:         "Unapplied",
    partially_applied: "Partial",
    fully_applied:     "Applied",
    overpaid:          "Overpaid",
  };
  return <span className={map[status]}>{labels[status]}</span>;
}

export default function CashApplication() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<CashApplication | null>(null);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [newPaymentForm, setNewPaymentForm] = useState({
    paymentReference: "",
    payorName: "",
    debtorId: "",
    paymentDate: new Date().toISOString().split("T")[0],
    totalReceived: "",
    paymentMethod: "ach" as CashApplication["paymentMethod"],
    notes: "",
  });
  const [applyLines, setApplyLines] = useState<{
    invoiceId: string;
    invoiceNumber: string;
    invoiceAmount: string;
    appliedAmount: string;
    varianceType: PaymentLine["varianceType"];
    varianceReason: string;
  }[]>([{ invoiceId: "", invoiceNumber: "", invoiceAmount: "", appliedAmount: "", varianceType: "full_match", varianceReason: "" }]);

  const { data: payments = [], isLoading } = useQuery<CashApplication[]>({ queryKey: ["/api/cash-applications"] });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices", { all: true }] });
  const { data: debtors = [] } = useQuery<Debtor[]>({ queryKey: ["/api/debtors"] });

  const createPaymentMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/cash-applications", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash-applications"] });
      setShowNewPayment(false);
      setNewPaymentForm({ paymentReference: "", payorName: "", debtorId: "", paymentDate: new Date().toISOString().split("T")[0], totalReceived: "", paymentMethod: "ach", notes: "" });
      toast({ title: "Payment recorded", description: "Cash receipt has been saved." });
    },
  });

  const applyMutation = useMutation({
    mutationFn: ({ id, lines }: { id: number; lines: object[] }) =>
      apiRequest("POST", `/api/cash-applications/${id}/apply`, { lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash-applications"] });
      setShowApplyDialog(false);
      setSelectedPayment(null);
      toast({ title: "Payment applied", description: "Invoice matching saved successfully." });
    },
  });

  const filtered = payments.filter(p => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (search && !p.payorName.toLowerCase().includes(search.toLowerCase()) && !p.paymentReference.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: payments.length,
    unapplied: payments.filter(p => p.status === "unapplied").length,
    partial: payments.filter(p => p.status === "partially_applied").length,
    overpaid: payments.filter(p => p.status === "overpaid").length,
    totalReceived: payments.reduce((s, p) => s + parseFloat(p.totalReceived || "0"), 0),
  };

  function handleApplyOpen(p: CashApplication) {
    setSelectedPayment(p);
    setApplyLines([{ invoiceId: "", invoiceNumber: "", invoiceAmount: "", appliedAmount: "", varianceType: "full_match", varianceReason: "" }]);
    setShowApplyDialog(true);
  }

  function handleLineChange(i: number, field: string, value: string) {
    setApplyLines(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === "invoiceId") {
        const inv = invoices.find(inv => inv.id === Number(value));
        if (inv) {
          const applied = next[i].appliedAmount || inv.amount;
          const diff = parseFloat(applied) - parseFloat(inv.amount);
          next[i].invoiceNumber = inv.invoiceNumber;
          next[i].invoiceAmount = inv.amount;
          next[i].varianceType = Math.abs(diff) < 0.01 ? "full_match" : diff < 0 ? "short_pay" : "overpay";
        }
      }
      if (field === "appliedAmount" && next[i].invoiceAmount) {
        const diff = parseFloat(value || "0") - parseFloat(next[i].invoiceAmount);
        next[i].varianceType = Math.abs(diff) < 0.01 ? "full_match" : diff < 0 ? "short_pay" : "overpay";
      }
      return next;
    });
  }

  function handleApplySubmit() {
    if (!selectedPayment) return;
    const lines = applyLines
      .filter(l => l.invoiceId)
      .map(l => ({
        invoiceId: Number(l.invoiceId),
        invoiceNumber: l.invoiceNumber,
        invoiceAmount: l.invoiceAmount,
        appliedAmount: l.appliedAmount,
        varianceType: l.varianceType,
        varianceReason: l.varianceReason || null,
        variance: String(parseFloat(l.appliedAmount || "0") - parseFloat(l.invoiceAmount || "0")),
      }));
    applyMutation.mutate({ id: selectedPayment.id, lines });
  }

  const needsAttention = stats.unapplied + stats.partial + stats.overpaid;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Cash Matching" subtitle="Match incoming payments to loads — handle short-pays, overpays, and reconciliation" group="Funding" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-6">

            {/* Stats strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: "Total Received",  value: fmtMoney(stats.totalReceived), warn: false },
                { label: "Total Payments",  value: stats.total,     warn: false },
                { label: "Unapplied",       value: stats.unapplied, warn: stats.unapplied > 0 },
                { label: "Partial",         value: stats.partial,   warn: stats.partial > 0 },
                { label: "Overpaid",        value: stats.overpaid,  warn: stats.overpaid > 0 },
              ].map(s => (
                <div
                  key={s.label}
                  className={cn(
                    "rounded-[12px] border px-4 py-3",
                    s.warn
                      ? "border-amber-200/70 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/10"
                      : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]"
                  )}
                >
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
                  <p className={cn(
                    "mt-0.5 text-[22px] font-bold tracking-tight",
                    s.warn ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-white"
                  )}>
                    {s.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Attention nudge */}
            {needsAttention > 0 && (
              <div className="flex items-center gap-2 rounded-[10px] border border-amber-200 bg-amber-50/70 px-4 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/10">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-[12.5px] font-medium text-amber-800 dark:text-amber-300">
                  <span className="font-bold">{needsAttention} payment{needsAttention !== 1 ? "s" : ""}</span> need matching — apply them to close out open invoices.
                </p>
              </div>
            )}

            {/* Main table card */}
            <div className="overflow-hidden rounded-[16px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              {/* Toolbar */}
              <div className="flex flex-col gap-4 border-b border-slate-200/70 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">Incoming Payments</h2>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search payor or ref…" className="h-9 pl-9 w-52 rounded-full text-[12px]" />
                  </div>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-9 w-40 rounded-full text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="unapplied">Unapplied</SelectItem>
                      <SelectItem value="partially_applied">Partially Applied</SelectItem>
                      <SelectItem value="fully_applied">Fully Applied</SelectItem>
                      <SelectItem value="overpaid">Overpaid</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() => setShowNewPayment(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Record Payment
                  </button>
                </div>
              </div>

              {/* Body */}
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                </div>
              ) : filtered.length === 0 ? (
                <FFEmpty
                  context="generic"
                  icon={Banknote}
                  title="No payments recorded"
                  detail="Record incoming payments to start matching them to invoices."
                  actions={[{
                    label: "Record Payment",
                    onClick: () => setShowNewPayment(true),
                    primary: true,
                  }]}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="ff-data-table w-full min-w-[820px]">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Payor</th>
                        <th>Date</th>
                        <th>Age</th>
                        <th className="text-right">Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th className="pr-5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(p => {
                        const age = paymentAgeDays(p.paymentDate);
                        const needsAction = p.status === "unapplied" || p.status === "partially_applied";
                        const isUrgent = needsAction && age >= 6;
                        const isStale  = needsAction && !isUrgent && age >= 3;
                        return (
                          <tr
                            key={p.id}
                            className={cn(
                              isUrgent ? "ff-row-urgent" :
                              isStale  ? "ff-row-stale"  : ""
                            )}
                          >
                            <td className="font-mono text-[12px] font-semibold text-slate-900 dark:text-white">
                              {p.paymentReference}
                            </td>
                            <td className="font-medium text-slate-800 dark:text-slate-200">
                              {p.payorName}
                            </td>
                            <td className="text-slate-500 dark:text-slate-400">
                              {new Date(p.paymentDate).toLocaleDateString()}
                            </td>
                            <td>
                              {needsAction
                                ? <AgePill dateStr={p.paymentDate} />
                                : <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
                              }
                            </td>
                            <td className="text-right font-semibold text-slate-900 dark:text-white">
                              {fmtMoney(p.totalReceived)}
                            </td>
                            <td className="capitalize text-slate-500 dark:text-slate-400">
                              {p.paymentMethod.replace("_", " ")}
                            </td>
                            <td>
                              <StatusBadge status={p.status} />
                            </td>
                            <td className="pr-5">
                              {needsAction && (
                                <button
                                  onClick={() => handleApplyOpen(p)}
                                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-blue-700"
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                  Match
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Footer count */}
              {filtered.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                  <span className="text-[11.5px] text-slate-400 dark:text-slate-500">{filtered.length} payments</span>
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                    {fmtMoney(filtered.reduce((s, p) => s + parseFloat(p.totalReceived || "0"), 0))}
                  </span>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Record Payment Dialog */}
      <Dialog open={showNewPayment} onOpenChange={setShowNewPayment}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle>Record Incoming Payment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment Reference</Label>
                <Input value={newPaymentForm.paymentReference} onChange={e => setNewPaymentForm(f => ({ ...f, paymentReference: e.target.value }))} placeholder="CHK-001, ACH-REF…" className="mt-1 rounded-xl" />
              </div>
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={newPaymentForm.paymentDate} onChange={e => setNewPaymentForm(f => ({ ...f, paymentDate: e.target.value }))} className="mt-1 rounded-xl" />
              </div>
            </div>
            <div>
              <Label>Payor Name</Label>
              <Input value={newPaymentForm.payorName} onChange={e => setNewPaymentForm(f => ({ ...f, payorName: e.target.value }))} placeholder="Company or debtor name" className="mt-1 rounded-xl" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount Received ($)</Label>
                <Input type="number" value={newPaymentForm.totalReceived} onChange={e => setNewPaymentForm(f => ({ ...f, totalReceived: e.target.value }))} placeholder="0.00" className="mt-1 rounded-xl" />
              </div>
              <div>
                <Label>Method</Label>
                <Select value={newPaymentForm.paymentMethod} onValueChange={v => setNewPaymentForm(f => ({ ...f, paymentMethod: v as typeof f.paymentMethod }))}>
                  <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ach">ACH</SelectItem>
                    <SelectItem value="wire">Wire</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Debtor (optional)</Label>
              <Select value={newPaymentForm.debtorId} onValueChange={v => setNewPaymentForm(f => ({ ...f, debtorId: v }))}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Link to debtor…" /></SelectTrigger>
                <SelectContent>
                  {debtors.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={newPaymentForm.notes} onChange={e => setNewPaymentForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="mt-1 rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPayment(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={() => createPaymentMutation.mutate({ ...newPaymentForm, debtorId: newPaymentForm.debtorId ? Number(newPaymentForm.debtorId) : null })} disabled={createPaymentMutation.isPending} className="rounded-xl bg-blue-600 text-white hover:bg-blue-700">
              {createPaymentMutation.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply to Invoices Dialog */}
      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Match Payment: {selectedPayment?.paymentReference}</DialogTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Total received: <span className="font-semibold text-slate-900 dark:text-white">{fmtMoney(selectedPayment?.totalReceived)}</span>
            </p>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[55vh] overflow-auto">
            {applyLines.map((line, i) => {
              const vConf = VARIANCE_STYLE[line.varianceType];
              const VIcon = vConf.icon;
              return (
                <div key={i} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Invoice</Label>
                      <Select value={line.invoiceId} onValueChange={v => handleLineChange(i, "invoiceId", v)}>
                        <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Select invoice…" /></SelectTrigger>
                        <SelectContent>
                          {invoices.filter(inv => inv.status !== "paid").map(inv => (
                            <SelectItem key={inv.id} value={String(inv.id)}>{inv.invoiceNumber} — {fmtMoney(inv.amount)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Applied Amount ($)</Label>
                      <Input type="number" value={line.appliedAmount} onChange={e => handleLineChange(i, "appliedAmount", e.target.value)} placeholder={line.invoiceAmount || "0.00"} className="mt-1 rounded-xl" />
                    </div>
                  </div>
                  {line.invoiceId && (
                    <div className="flex items-center gap-2 text-sm">
                      <VIcon className={cn("h-4 w-4", vConf.color)} />
                      <span className={vConf.color}>{vConf.label}</span>
                      {line.varianceType !== "full_match" && (
                        <span className="text-slate-500">
                          — variance: {fmtMoney(parseFloat(line.appliedAmount || "0") - parseFloat(line.invoiceAmount || "0"))}
                        </span>
                      )}
                    </div>
                  )}
                  {(line.varianceType === "short_pay" || line.varianceType === "overpay") && (
                    <div>
                      <Label>Variance Reason</Label>
                      <Input value={line.varianceReason} onChange={e => handleLineChange(i, "varianceReason", e.target.value)} placeholder="Explain the discrepancy…" className="mt-1 rounded-xl" />
                    </div>
                  )}
                </div>
              );
            })}
            <Button variant="outline" onClick={() => setApplyLines(l => [...l, { invoiceId: "", invoiceNumber: "", invoiceAmount: "", appliedAmount: "", varianceType: "full_match", varianceReason: "" }])} className="w-full rounded-xl border-dashed">
              <Plus className="mr-1.5 h-4 w-4" /> Add Another Invoice
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyDialog(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleApplySubmit} disabled={applyMutation.isPending} className="rounded-xl bg-blue-600 text-white hover:bg-blue-700">
              {applyMutation.isPending ? "Applying…" : "Apply Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

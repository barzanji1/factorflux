import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { PageInsights } from "@/components/PageInsights";
import { FundingButton as Button, FundingCard as Card, FundingInput as Input, FundingDialogContent as DialogContent, FundingSelectTrigger as SelectTrigger, FundingSelectContent as SelectContent } from "@/components/funding/funding-controls";
import {
  CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  NeuTable as Table,
  NeuTableBody as TableBody,
  NeuTableCell as TableCell,
  NeuTableHead as TableHead,
  NeuTableHeader as TableHeader,
  NeuTableRow as TableRow,
} from "@/styles/neu/components";
import {
  Dialog, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectItem, SelectValue,
} from "@/components/ui/select";
import { NeuTextarea as Textarea } from "@/styles/neu";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import {
  DollarSign, TrendingUp, PiggyBank, CheckCircle2, Plus,
  Settings2, Loader2, RefreshCw, Info, ExternalLink,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import "@/components/funding/funding-neu.css";
import { FundingStatCard } from "@/components/funding/funding-stat-card";
import { NeuPageShell } from "@/styles/neu/components";
import { FundingBadge } from "@/components/funding/funding-badge";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PayoutSettings {
  id: number;
  advanceRate: string;
  feeRate: string;
  updatedAt?: string;
}

interface PayoutRow {
  id: number;
  invoiceId: number;
  invoiceNumber?: string;
  clientName?: string;
  invoiceAmount: string;
  advanceRate: string;
  feeRate: string;
  advanceAmount: string;
  feeAmount: string;
  reserveAmount: string;
  netPayout: string;
  paymentStatus: string;
  advancePaidAt?: string | null;
  reserveReleasedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  amount: string;
  clientId: number;
  status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v));

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_advance: { label: "Pending Advance", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  advance_paid: { label: "Advance Paid", color: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  reserve_pending: { label: "Reserve Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  reserve_released: { label: "Reserve Released", color: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" },
  complete: { label: "Complete", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
};

const STATUS_ORDER = ["pending_advance", "advance_paid", "reserve_pending", "reserve_released", "complete"];

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "bg-slate-100 text-slate-600" };
  const tone = status === "complete" ? "success" : status === "reserve_pending" || status === "pending_advance" ? "warning" : status === "advance_paid" ? "accent" : "neutral";
  return <FundingBadge tone={tone} className={`${meta.color} rounded-full border-0 font-medium`}>{meta.label}</FundingBadge>;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const settingsSchema = z.object({
  advanceRate: z.coerce.number().min(1, "Min 1%").max(99, "Max 99%"),
  feeRate: z.coerce.number().min(0, "Min 0%").max(50, "Max 50%"),
}).refine((d) => d.advanceRate + d.feeRate <= 100, {
  message: "Advance rate + fee rate cannot exceed 100%",
  path: ["feeRate"],
});

const createPayoutSchema = z.object({
  invoiceId: z.coerce.number().positive("Select an invoice"),
  notes: z.string().optional(),
});

type SettingsForm = z.infer<typeof settingsSchema>;
type CreatePayoutForm = z.infer<typeof createPayoutSchema>;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Payouts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailPayout, setDetailPayout] = useState<PayoutRow | null>(null);

  // ── Queries ──
  const { data: settings, isLoading: settingsLoading } = useQuery<PayoutSettings>({
    queryKey: ["/api/payout-settings"],
  });

  const { data: payouts = [], isLoading: payoutsLoading } = useQuery<PayoutRow[]>({
    queryKey: ["/api/payouts"],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", { all: true }],
  });

  // Invoices without a payout record yet
  const payoutInvoiceIds = new Set(payouts.map((p) => p.invoiceId));
  const eligibleInvoices = invoices.filter(
    (inv) => !payoutInvoiceIds.has(inv.id) && Number(inv.amount) > 0,
  );

  // ── Summary stats ──
  const totals = payouts.reduce(
    (acc, p) => ({
      advanced: acc.advanced + Number(p.advanceAmount),
      fees: acc.fees + Number(p.feeAmount),
      reserveHeld: acc.reserveHeld + (["pending_advance", "advance_paid", "reserve_pending"].includes(p.paymentStatus) ? Number(p.reserveAmount) : 0),
      complete: acc.complete + (p.paymentStatus === "complete" ? 1 : 0),
    }),
    { advanced: 0, fees: 0, reserveHeld: 0, complete: 0 },
  );

  // ── Mutations ──
  const settingsMutation = useMutation({
    mutationFn: async (data: SettingsForm) => {
      const res = await fetch("/api/payout-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payout-settings"] });
      setSettingsOpen(false);
      toast({ title: "Settings saved", description: "New rates apply to future payouts." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreatePayoutForm) => {
      const res = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invoiceId: Number(data.invoiceId), notes: data.notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to create payout");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      setCreateOpen(false);
      toast({ title: "Payout record created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, paymentStatus }: { id: number; paymentStatus: string }) => {
      const res = await fetch(`/api/payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ paymentStatus }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to update");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payouts"] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Forms ──
  const settingsForm = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { advanceRate: 80, feeRate: 3 },
    values: settings ? { advanceRate: Number(settings.advanceRate), feeRate: Number(settings.feeRate) } : undefined,
  });

  const createForm = useForm<CreatePayoutForm>({
    resolver: zodResolver(createPayoutSchema),
    defaultValues: { invoiceId: 0, notes: "" },
  });

  // Live preview in create modal
  const watchedInvoiceId = createForm.watch("invoiceId");
  const previewInvoice = invoices.find((i) => i.id === Number(watchedInvoiceId));
  const preview = previewInvoice && settings
    ? (() => {
        const amt = Number(previewInvoice.amount);
        const ar = Number(settings.advanceRate) / 100;
        const fr = Number(settings.feeRate) / 100;
        return {
          advance: +(amt * ar).toFixed(2),
          fee: +(amt * fr).toFixed(2),
          reserve: +(amt * (1 - ar)).toFixed(2),
          net: +(amt * ar - amt * fr).toFixed(2),
        };
      })()
    : null;

  // Live preview in settings modal
  const watchAdvance = settingsForm.watch("advanceRate") ?? 80;
  const watchFee = settingsForm.watch("feeRate") ?? 3;
  const sampleAmt = 10000;
  const settingsPreview = {
    advance: +((sampleAmt * watchAdvance) / 100).toFixed(2),
    fee: +((sampleAmt * watchFee) / 100).toFixed(2),
    reserve: +((sampleAmt * (100 - watchAdvance)) / 100).toFixed(2),
    net: +((sampleAmt * watchAdvance) / 100 - (sampleAmt * watchFee) / 100).toFixed(2),
  };

  return (
    <div className="funding-neu-page ff-payments-page flex h-screen bg-[#d4d0c8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Payouts" subtitle="Advance disbursements and reserve management" group="Funding" neu />
        <NeuPageShell className="custom-scrollbar flex-1 overflow-auto p-6">
          <PageInsights entity="payouts" title="Payout activity" />
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Header row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Payout Tracking</h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Transparent factoring calculations — advance, fee, reserve, and net payout per invoice
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} className="gap-2">
                  <Settings2 className="h-4 w-4" />
                  Rates
                  {settings && (
                    <span className="ml-1 text-xs text-slate-400">
                      {settings.advanceRate}% / {settings.feeRate}%
                    </span>
                  )}
                </Button>
                <Button onClick={() => { createForm.reset(); setCreateOpen(true); }} className="gap-2">
                  <Plus className="h-4 w-4" />
                  New Payout
                </Button>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                {
                  label: "Total Advanced",
                  value: fmt(totals.advanced),
                  icon: TrendingUp,
                  color: "text-blue-600 dark:text-blue-400",
                  bg: "bg-blue-50 dark:bg-blue-950/30",
                },
                {
                  label: "Total Fees",
                  value: fmt(totals.fees),
                  icon: DollarSign,
                  color: "text-amber-600 dark:text-amber-400",
                  bg: "bg-amber-50 dark:bg-amber-950/30",
                },
                {
                  label: "Reserve Held",
                  value: fmt(totals.reserveHeld),
                  icon: PiggyBank,
                  color: "text-violet-600 dark:text-violet-400",
                  bg: "bg-violet-50 dark:bg-violet-950/30",
                },
                {
                  label: "Fully Complete",
                  value: totals.complete,
                  icon: CheckCircle2,
                  color: "text-emerald-600 dark:text-emerald-400",
                  bg: "bg-emerald-50 dark:bg-emerald-950/30",
                },
              ].map((stat) => (
                <FundingStatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  icon={<stat.icon className="h-5 w-5" />}
                  className="min-h-32 p-4"
                />
              ))}
            </div>

            {/* Rates info bar */}
            {settings && (
              <div className="ff-payments-surface flex flex-wrap items-center gap-4 border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20 px-4 py-3 text-sm">
                <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <span className="text-blue-700 dark:text-blue-300">
                  Current rates — Advance: <strong>{settings.advanceRate}%</strong> · Fee: <strong>{settings.feeRate}%</strong> · Reserve: <strong>{(100 - Number(settings.advanceRate)).toFixed(2)}%</strong>
                </span>
                <span className="text-blue-500 dark:text-blue-400 text-xs ml-auto">
                  On a $10,000 invoice: carrier receives {fmt((10000 * Number(settings.advanceRate)) / 100 - (10000 * Number(settings.feeRate)) / 100)} net, {fmt((10000 * (100 - Number(settings.advanceRate))) / 100)} in reserve
                </span>
              </div>
            )}

            {/* Payouts table */}
            <Card className="ff-payments-surface overflow-hidden border border-[hsl(var(--border))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Payout History
                </CardTitle>
                <CardDescription>All factored invoice payouts with full amount breakdown</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {payoutsLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" /> Loading payouts...
                  </div>
                ) : payouts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <DollarSign className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-slate-500 dark:text-slate-400 font-medium">No payout records yet</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Create a payout record for an approved invoice to get started.</p>
                    <Button className="mt-4 gap-2" onClick={() => { createForm.reset(); setCreateOpen(true); }}>
                      <Plus className="h-4 w-4" /> New Payout
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Carrier</TableHead>
                          <TableHead className="text-right">Invoice Amt</TableHead>
                          <TableHead className="text-right">Advance</TableHead>
                          <TableHead className="text-right">Fee</TableHead>
                          <TableHead className="text-right">Reserve</TableHead>
                          <TableHead className="text-right font-semibold">Net Payout</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Update</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.map((p) => (
                          <TableRow
                            key={p.id}
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            onClick={() => setDetailPayout(p)}
                          >
                            <TableCell className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">
                              {p.invoiceNumber ?? `#${p.invoiceId}`}
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              {p.clientName ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-slate-600 dark:text-slate-300">
                              {fmt(p.invoiceAmount)}
                            </TableCell>
                            <TableCell className="text-right text-blue-600 dark:text-blue-400 font-medium">
                              {fmt(p.advanceAmount)}
                              <span className="ml-1 text-xs text-slate-400">({p.advanceRate}%)</span>
                            </TableCell>
                            <TableCell className="text-right text-amber-600 dark:text-amber-400">
                              {fmt(p.feeAmount)}
                              <span className="ml-1 text-xs text-slate-400">({p.feeRate}%)</span>
                            </TableCell>
                            <TableCell className="text-right text-violet-600 dark:text-violet-400">
                              {fmt(p.reserveAmount)}
                            </TableCell>
                            <TableCell className="text-right font-bold text-emerald-600 dark:text-emerald-400 text-base">
                              {fmt(p.netPayout)}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <StatusBadge status={p.paymentStatus} />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Select
                                value={p.paymentStatus}
                                onValueChange={(val) => statusMutation.mutate({ id: p.id, paymentStatus: val })}
                              >
                                <SelectTrigger className="h-7 w-[130px] text-xs">
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUS_ORDER.map((s) => (
                                    <SelectItem key={s} value={s} className="text-xs">
                                      {STATUS_META[s].label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/payouts/${p.id}`)}
                                className="h-7 gap-1.5 px-2 text-xs"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />Detail
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </NeuPageShell>
      </div>

      {/* ── Settings Modal ─────────────────────────────────────────────────── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="funding-neu-dialog ff-payments-surface sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Factoring Rate Settings
            </DialogTitle>
            <DialogDescription>
              Configure advance and fee percentages. These rates apply to all new payout records.
              Existing payouts keep their original snapshot rates.
            </DialogDescription>
          </DialogHeader>
          <Form {...settingsForm}>
            <form onSubmit={settingsForm.handleSubmit((d) => settingsMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={settingsForm.control} name="advanceRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Rate (%)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.1" min={1} max={99} />
                    </FormControl>
                    <FormDescription className="text-xs">Paid to carrier upfront</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={settingsForm.control} name="feeRate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fee Rate (%)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.1" min={0} max={50} />
                    </FormControl>
                    <FormDescription className="text-xs">Factoring fee charged</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Live preview */}
              <div className="ff-payments-surface border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Live preview — $10,000 invoice
                </p>
                {[
                  { label: "Advance amount", value: fmt(settingsPreview.advance), color: "text-blue-600 dark:text-blue-400" },
                  { label: "Factoring fee", value: fmt(settingsPreview.fee), color: "text-amber-600 dark:text-amber-400" },
                  { label: "Reserve held", value: fmt(settingsPreview.reserve), color: "text-violet-600 dark:text-violet-400" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-slate-500">{label}</span>
                    <span className={`font-medium ${color}`}>{value}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-slate-700 dark:text-slate-300">Net payout to carrier</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{fmt(settingsPreview.net)}</span>
                </div>
                <p className="text-xs text-slate-400">
                  Reserve = {(100 - watchAdvance).toFixed(2)}% · Released when debtor pays
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={settingsMutation.isPending}>
                  {settingsMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : "Save Rates"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Create Payout Modal ────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="funding-neu-dialog ff-payments-surface sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Payout Record
            </DialogTitle>
            <DialogDescription>
              Select an invoice to calculate and track its factoring payout.
              Amounts are calculated using the current rates and locked in as a snapshot.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <FormField control={createForm.control} name="invoiceId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an invoice…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {eligibleInvoices.length === 0 ? (
                        <SelectItem value="0" disabled>No eligible invoices</SelectItem>
                      ) : (
                        eligibleInvoices.map((inv) => (
                          <SelectItem key={inv.id} value={String(inv.id)}>
                            {inv.invoiceNumber} — {fmt(inv.amount)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Calculation preview */}
              {preview && (
                <div className="ff-payments-surface border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                    Calculation preview
                  </p>
                  {[
                    { label: `Advance (${settings?.advanceRate}%)`, value: fmt(preview.advance), color: "text-blue-600 dark:text-blue-400" },
                    { label: `Fee (${settings?.feeRate}%)`, value: fmt(preview.fee), color: "text-amber-600 dark:text-amber-400" },
                    { label: "Reserve held", value: fmt(preview.reserve), color: "text-violet-600 dark:text-violet-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex justify-between text-sm">
                      <span className="text-slate-500">{label}</span>
                      <span className={`font-medium ${color}`}>{value}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between font-bold text-sm">
                    <span className="text-slate-700 dark:text-slate-300">Net payout to carrier</span>
                    <span className="text-emerald-600 dark:text-emerald-400 text-base">{fmt(preview.net)}</span>
                  </div>
                </div>
              )}

              <FormField control={createForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Any notes about this payout…" rows={2} className="resize-none" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || !watchedInvoiceId}>
                  {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : "Create Payout"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Payout Detail Modal ────────────────────────────────────────────── */}
      <Dialog open={!!detailPayout} onOpenChange={(o) => { if (!o) setDetailPayout(null); }}>
        <DialogContent className="ff-payments-surface sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              Payout Detail — {detailPayout?.invoiceNumber ?? `Invoice #${detailPayout?.invoiceId}`}
            </DialogTitle>
            <DialogDescription>{detailPayout?.clientName}</DialogDescription>
          </DialogHeader>
          {detailPayout && (
            <div className="space-y-3">
              <div className="ff-payments-surface overflow-hidden border border-slate-200 dark:border-slate-700">
                {[
                  { label: "Invoice Amount", value: fmt(detailPayout.invoiceAmount), mono: false },
                  { label: `Advance (${detailPayout.advanceRate}%)`, value: fmt(detailPayout.advanceAmount), color: "text-blue-600 dark:text-blue-400" },
                  { label: `Fee (${detailPayout.feeRate}%)`, value: fmt(detailPayout.feeAmount), color: "text-amber-600 dark:text-amber-400" },
                  { label: "Reserve Held", value: fmt(detailPayout.reserveAmount), color: "text-violet-600 dark:text-violet-400" },
                  { label: "Net Payout", value: fmt(detailPayout.netPayout), color: "text-emerald-600 dark:text-emerald-400 font-bold text-base" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between items-center px-4 py-2.5 text-sm border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <span className="text-slate-500">{label}</span>
                    <span className={color ?? "text-slate-900 dark:text-white font-medium"}>{value}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Payment Status</span>
                <StatusBadge status={detailPayout.paymentStatus} />
              </div>

              {detailPayout.advancePaidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Advance Paid</span>
                  <span className="text-slate-700 dark:text-slate-300">{new Date(detailPayout.advancePaidAt).toLocaleDateString()}</span>
                </div>
              )}
              {detailPayout.reserveReleasedAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Reserve Released</span>
                  <span className="text-slate-700 dark:text-slate-300">{new Date(detailPayout.reserveReleasedAt).toLocaleDateString()}</span>
                </div>
              )}
              {detailPayout.notes && (
                <div className="ff-payments-surface bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
                  {detailPayout.notes}
                </div>
              )}
              <p className="text-xs text-slate-400">
                Created {detailPayout.createdAt ? new Date(detailPayout.createdAt).toLocaleString() : "—"}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

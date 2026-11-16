import { useParams, useLocation } from "wouter";
import { PageInsights } from "@/components/PageInsights";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import "@/components/admin-neu/admin-neu-page.css";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import RecordDetail, {
  DetailRow, DetailSection, EmptyTab,
} from "@/components/layout/record-detail";
import EntityNotes from "@/components/shared/EntityNotes";
import { Badge, Button } from "@/components/admin-neu/adapters";
import { NeuCard } from "@/styles/neu/components";

import {
  Banknote, ReceiptText, CheckCircle2, DollarSign,
  TrendingUp, PlayCircle, ArrowRight,
  Building2, Percent,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string }> = {
  pending_advance:  { label: "Pending Advance" },
  advance_paid:     { label: "Advance Paid" },
  reserve_pending:  { label: "Reserve Pending" },
  reserve_released: { label: "Reserve Released" },
  complete:         { label: "Complete" },
};

const STATUS_ORDER = ["pending_advance", "advance_paid", "reserve_pending", "reserve_released", "complete"];

function PayoutStatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending_advance;
  return (
    <Badge tone={status === "complete" ? "success" : status === "reserve_pending" || status === "pending_advance" ? "warning" : "accent"}>
      {m.label}
    </Badge>
  );
}

const fmt = (v: string | number | null | undefined) =>
  v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtPct = (v: string | number | null | undefined) =>
  v == null ? "—" : `${parseFloat(String(v)).toFixed(2)}%`;

// ─── Status pipeline strip ────────────────────────────────────────────────────

function PayoutPipeline({ status }: { status: string }) {
  const current = STATUS_ORDER.indexOf(status);
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-[#168d99]" />
        <h2 className="text-sm font-semibold text-[#444]">Payout Progress</h2>
        <span className="ml-auto rounded-full bg-[#e0e0e0] px-2.5 py-0.5 text-[11px] font-semibold text-[#168d99] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]">
          Step {current + 1} of {STATUS_ORDER.length} · {STATUS_META[status]?.label ?? status}
        </span>
      </div>
      <div className="flex items-start gap-0">
        {STATUS_ORDER.map((s, idx) => {
          const done   = idx < current;
          const active = idx === current;
          const isLast = idx === STATUS_ORDER.length - 1;
          return (
            <div key={s} className="flex flex-1 flex-col items-center gap-2">
              <div className="flex w-full items-center">
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all",
                  done   ? "border-0 bg-[#d4eeee] text-[#168d99] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"
                  : active ? "border-0 bg-[#e0e0e0] text-[#168d99] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"
                  : "border-0 bg-[#e0e0e0] text-[#888] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]",
                )}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <span>{idx + 1}</span>}
                </div>
                <div className={cn("h-0.5 flex-1", isLast ? "invisible" : done ? "bg-[#27aab8]" : "bg-[#c9c9c9]")} />
              </div>
              <span className={cn("text-center text-[10px] font-semibold leading-tight max-w-[80px]",
                active ? "text-[#168d99]"
                : done  ? "text-[#168d99]"
                : "text-[#888]",
              )}>
                {STATUS_META[s]?.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Transition actions ───────────────────────────────────────────────────────

const TRANSITIONS: Array<{ from: string[]; to: string; label: string; desc: string; variant: "primary" | "success" }> = [
  { from: ["pending_advance"],  to: "advance_paid",     label: "Mark Advance Paid",     desc: "Confirm advance funds have been sent to the carrier.", variant: "primary" },
  { from: ["advance_paid"],     to: "reserve_pending",  label: "Move to Reserve Pending", desc: "Invoice sent to debtor — awaiting debtor payment.", variant: "primary" },
  { from: ["reserve_pending"],  to: "reserve_released", label: "Release Reserve",        desc: "Debtor paid — release the reserve to the carrier.", variant: "primary" },
  { from: ["reserve_released"], to: "complete",         label: "Mark Complete",          desc: "All funds disbursed. Close out this payout.", variant: "success" },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PayoutDetail() {
  const { id } = useParams<{ id: string }>();
  const payoutId = Number(id);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: payout, isLoading } = useQuery<any>({
    queryKey: ["/api/payouts", payoutId],
    queryFn: async () => {
      const r = await fetch(`/api/payouts/${payoutId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !isNaN(payoutId),
  });

  const transitionMutation = useMutation({
    mutationFn: (paymentStatus: string) =>
      apiRequest("PATCH", `/api/payouts/${payoutId}`, { paymentStatus }),
    onSuccess: () => {
      toast({ title: "Payout status updated" });
      qc.invalidateQueries({ queryKey: ["/api/payouts", payoutId] });
      qc.invalidateQueries({ queryKey: ["/api/payouts"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const currentStatus = payout?.paymentStatus ?? "pending_advance";
  const availableTransitions = TRANSITIONS.filter(t => t.from.includes(currentStatus));

  return (
    <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Payout Detail"
          subtitle="Advance, fee, and reserve breakdown with disbursement tracking"
          group="Workspace"
        />
        <main className="custom-scrollbar flex-1 overflow-auto bg-[#e0e0e0]">
          <PageInsights entity="payouts" entityId={payoutId} title="Payout activity" />
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">
            <RecordDetail
              backHref="/payouts"
              backLabel="Back to Payouts"
              isLoading={isLoading}
              notFound={!isLoading && !payout}
              notFoundIcon={<Banknote className="h-8 w-8" />}
              notFoundLabel="Payout not found"
              icon={<Banknote className="h-7 w-7" />}
              iconBg="bg-[#e0e0e0] text-[#168d99] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"
              title={`Payout #${payoutId}`}
              titleSub={[
                payout?.invoiceNumber ? `Invoice ${payout.invoiceNumber}` : null,
                payout?.clientName    ? payout.clientName                 : null,
                fmtDate(payout?.createdAt),
              ].filter(Boolean).join(" · ")}
              statusBadge={payout ? <PayoutStatusBadge status={payout.paymentStatus} /> : undefined}
              metrics={[
                { label: "Net Payout",     value: fmt(payout?.netPayout),     tint: "violet"  },
                { label: "Advance Amount", value: fmt(payout?.advanceAmount), tint: "blue"    },
                { label: "Fee Amount",     value: fmt(payout?.feeAmount),     tint: "amber"   },
                { label: "Reserve",        value: fmt(payout?.reserveAmount), tint: "slate"   },
                { label: "Invoice Amount", value: fmt(payout?.invoiceAmount), tint: "slate"   },
              ]}
              statusStrip={payout ? <PayoutPipeline status={payout.paymentStatus} /> : undefined}
              linkedRecords={[
                {
                  label: "Invoice",
                  icon: <ReceiptText className="h-4 w-4" />,
                  value: payout?.invoiceNumber ?? `#${payout?.invoiceId}`,
                  sub: fmt(payout?.invoiceAmount),
                  href: payout?.invoiceId ? `/invoices/${payout.invoiceId}` : undefined,
                  tint: "blue",
                },
                {
                  label: "Client",
                  icon: <Building2 className="h-4 w-4" />,
                  value: payout?.clientName ?? "—",
                  tint: "emerald",
                },
                {
                  label: "Advance Rate",
                  icon: <Percent className="h-4 w-4" />,
                  value: fmtPct(payout?.advanceRate),
                  tint: "violet",
                },
                {
                  label: "Fee Rate",
                  icon: <Percent className="h-4 w-4" />,
                  value: fmtPct(payout?.feeRate),
                  tint: "amber",
                },
              ]}
              actions={isAdmin ? (
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#777]">Lifecycle Actions</p>
                  {availableTransitions.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-xl bg-[#dceaea] px-3 py-2.5 text-xs text-[#168d99] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {currentStatus === "complete" ? "Payout is complete." : "No actions available."}
                    </div>
                  ) : (
                    availableTransitions.map(t => (
                      <div key={t.to} className="space-y-1">
                        <p className="text-[11px] text-[#777]">{t.desc}</p>
                        <Button
                          size="sm"
                          disabled={transitionMutation.isPending}
                          onClick={() => transitionMutation.mutate(t.to)}
                            variant="accent"
                            className="w-full justify-start gap-2 text-xs"
                        >
                          <PlayCircle className="h-3.5 w-3.5 shrink-0" />
                          {transitionMutation.isPending ? "Processing..." : t.label}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="px-5 py-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#777]">Status</p>
                  {payout && <PayoutStatusBadge status={payout.paymentStatus} />}
                </div>
              )}
              rightExtra={
                <NeuCard className="overflow-hidden rounded-2xl">
                  <div className="border-b border-[#c9c9c9] px-5 py-4">
                    <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-[#168d99]" />
                    <h3 className="text-xs font-semibold text-[#444]">Fund Breakdown</h3>
                    </div>
                  </div>
                  <div className="divide-y divide-[#c9c9c9] px-5">
                    {[
                      { label: "Invoice Face Value", value: fmt(payout?.invoiceAmount), note: "100%" },
                      { label: `Advance (${fmtPct(payout?.advanceRate)})`, value: fmt(payout?.advanceAmount), note: "paid now" },
                      { label: `Fee (${fmtPct(payout?.feeRate)})`,         value: fmt(payout?.feeAmount),     note: "deducted" },
                      { label: "Reserve",             value: fmt(payout?.reserveAmount), note: "held" },
                      { label: "Net Payout",          value: fmt(payout?.netPayout),     note: "to carrier" },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between py-3">
                        <div>
                          <p className="text-xs text-[#555]">{r.label}</p>
                          <p className="text-[11px] text-[#888]">{r.note}</p>
                        </div>
                        <span className="text-sm font-semibold text-[#333]">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </NeuCard>
              }
              tabs={[
                {
                  value: "overview",
                  label: "Overview",
                  icon: <Banknote className="h-3.5 w-3.5" />,
                  content: (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <DetailSection title="Payout Details">
                        <DetailRow label="Invoice Number"  value={payout?.invoiceNumber} />
                        <DetailRow label="Invoice Amount"  value={fmt(payout?.invoiceAmount)} />
                        <DetailRow label="Advance Rate"    value={fmtPct(payout?.advanceRate)} />
                        <DetailRow label="Advance Amount"  value={fmt(payout?.advanceAmount)} />
                        <DetailRow label="Fee Rate"        value={fmtPct(payout?.feeRate)} />
                        <DetailRow label="Fee Amount"      value={fmt(payout?.feeAmount)} />
                        <DetailRow label="Reserve Amount"  value={fmt(payout?.reserveAmount)} />
                        <DetailRow label="Net Payout"      value={fmt(payout?.netPayout)} />
                      </DetailSection>
                      <DetailSection title="Disbursement Timeline">
                        <DetailRow label="Created"          value={fmtDate(payout?.createdAt)} />
                        <DetailRow label="Advance Paid At"  value={fmtDate(payout?.advancePaidAt)} />
                        <DetailRow label="Reserve Released" value={fmtDate(payout?.reserveReleasedAt)} />
                        <DetailRow label="Current Status"   value={STATUS_META[payout?.paymentStatus]?.label ?? payout?.paymentStatus} />
                      </DetailSection>
                      {payout?.notes && (
                        <div className="md:col-span-2">
                          <DetailSection title="Notes">
                            <div className="rounded-xl bg-[#e0e0e0] p-4 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                              <p className="text-sm text-[#444]">{payout.notes}</p>
                            </div>
                          </DetailSection>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  value: "invoice",
                  label: "Linked Invoice",
                  icon: <ReceiptText className="h-3.5 w-3.5" />,
                  content: payout?.invoiceId ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between rounded-xl bg-[#e0e0e0] px-4 py-4 shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e0e0e0] text-[#168d99] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]">
                            <ReceiptText className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-[#333]">{payout.invoiceNumber ?? `Invoice #${payout.invoiceId}`}</p>
                            {payout.clientName && <p className="text-xs text-[#777]">{payout.clientName}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-semibold text-[#333]">{fmt(payout.invoiceAmount)}</span>
                          <Button variant="outline" size="sm"
                            onClick={() => navigate(`/invoices/${payout.invoiceId}`)}
                            className="gap-1.5 text-xs">
                            <ArrowRight className="h-3.5 w-3.5" />View Invoice
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyTab icon={<ReceiptText className="h-7 w-7" />} label="No linked invoice" />
                  ),
                },
              ]}
            />
            {payout && <EntityNotes key={`payout:${payoutId}`} entityType="payout" entityId={payoutId} />}
          </div>
        </main>
      </div>
    </div>
  );
}

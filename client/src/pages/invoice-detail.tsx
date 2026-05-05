import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileText,
  DollarSign,
  AlertTriangle,
  CreditCard,
  Clock,
  TrendingUp,
  Package,
  User,
  Building2,
  Calendar,
  ExternalLink,
  FileCheck,
  ReceiptText,
  Banknote,
  ShieldAlert,
  Activity,
  ChevronRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

const FACTORING_STAGES = [
  "document_intake",
  "verification",
  "approval",
  "advance",
  "collections",
  "payment_receipt",
  "reconciliation",
  "final_settlement",
] as const;

type FactoringStage = (typeof FACTORING_STAGES)[number];

const STAGE_META: Record<FactoringStage, { label: string; description: string }> = {
  document_intake:  { label: "Document Intake",  description: "Receiving carrier documents"         },
  verification:     { label: "Verification",      description: "Docs, credit & broker checks"        },
  approval:         { label: "Approval",          description: "Factor review & funding decision"     },
  advance:          { label: "Advance",           description: "Advance sent to carrier"              },
  collections:      { label: "Collections",       description: "Collecting from broker/debtor"        },
  payment_receipt:  { label: "Payment Receipt",   description: "Payment received"                     },
  reconciliation:   { label: "Reconciliation",    description: "Matching payment to balance"          },
  final_settlement: { label: "Final Settlement",  description: "Reserve released — fully settled"     },
};

// ─── Stage pipeline ───────────────────────────────────────────────────────────

function StagePipeline({ current }: { current: FactoringStage }) {
  const currentIdx = FACTORING_STAGES.indexOf(current);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[700px] items-start gap-0 py-2">
        {FACTORING_STAGES.map((stage, idx) => {
          const done    = idx < currentIdx;
          const active  = idx === currentIdx;
          const future  = idx > currentIdx;
          const meta    = STAGE_META[stage];
          const isLast  = idx === FACTORING_STAGES.length - 1;
          return (
            <div key={stage} className="flex flex-1 items-start">
              <div className="flex flex-col items-center gap-1.5 flex-1">
                {/* Circle + connector */}
                <div className="relative flex w-full items-center">
                  {/* Left connector */}
                  <div className={cn("h-0.5 flex-1", idx === 0 ? "invisible" : done || active ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700")} />
                  {/* Node */}
                  <div className={cn(
                    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                    done   && "border-blue-500 bg-blue-500 text-white",
                    active && "border-blue-600 bg-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.18)]",
                    future && "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500",
                  )}>
                    {done ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : active ? (
                      <span className="text-[11px] font-bold">{idx + 1}</span>
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </div>
                  {/* Right connector */}
                  <div className={cn("h-0.5 flex-1", isLast ? "invisible" : done ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700")} />
                </div>
                {/* Label */}
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className={cn(
                    "text-[11px] font-semibold leading-tight",
                    active ? "text-blue-700 dark:text-blue-300" : done ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500",
                  )}>
                    {meta.label}
                  </span>
                  {active && (
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 max-w-[90px] leading-snug">
                      {meta.description}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    paid:     "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    funded:   "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300",
    submitted:"border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
    rejected: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
    settled:  "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-300",
    draft:    "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  const cls = colors[status] ?? colors.draft;
  return (
    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold shadow-sm", cls)}>
      {status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
    </Badge>
  );
}

// ─── Timeline event icon ──────────────────────────────────────────────────────

function TimelineIcon({ category }: { category: string }) {
  const styles: Record<string, { icon: React.ReactNode; bg: string }> = {
    stage:      { icon: <TrendingUp className="h-3.5 w-3.5" />,    bg: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" },
    status:     { icon: <Activity className="h-3.5 w-3.5" />,      bg: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    document:   { icon: <FileText className="h-3.5 w-3.5" />,      bg: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" },
    payout:     { icon: <Banknote className="h-3.5 w-3.5" />,      bg: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300" },
    payment:    { icon: <DollarSign className="h-3.5 w-3.5" />,    bg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" },
    collection: { icon: <CreditCard className="h-3.5 w-3.5" />,    bg: "bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300" },
    exception:  { icon: <AlertTriangle className="h-3.5 w-3.5" />, bg: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300" },
    system:     { icon: <Clock className="h-3.5 w-3.5" />,         bg: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  };
  const s = styles[category] ?? styles.system;
  return (
    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", s.bg)}>
      {s.icon}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyTabState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const invoiceId = Number(id);

  const { data: detail, isLoading: detailLoading } = useQuery<any>({
    queryKey: ["/api/invoices", invoiceId, "detail"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/detail`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch detail");
      return r.json();
    },
    enabled: !isNaN(invoiceId),
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery<any[]>({
    queryKey: ["/api/invoices", invoiceId, "timeline"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/timeline`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch timeline");
      return r.json();
    },
    enabled: !isNaN(invoiceId),
  });

  const currentStage = (detail?.factoringStage ?? "document_intake") as FactoringStage;
  const fmtCurrency = (v: string | number | null | undefined) =>
    v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (v: string | Date | null | undefined) =>
    v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.06),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Invoice Detail"
          subtitle="Unified factoring lifecycle view"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">
            {/* Back button */}
            <Button
              variant="ghost"
              onClick={() => navigate("/invoices")}
              className="mb-5 -ml-2 gap-2 rounded-xl text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Invoices
            </Button>

            {detailLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-36 w-full rounded-3xl" />
                <Skeleton className="h-24 w-full rounded-3xl" />
                <Skeleton className="h-64 w-full rounded-3xl" />
              </div>
            ) : !detail ? (
              <div className="flex flex-col items-center justify-center py-32">
                <ReceiptText className="mb-4 h-12 w-12 text-slate-300" />
                <p className="text-lg font-semibold text-slate-700 dark:text-white">Invoice not found</p>
                <p className="mt-1 text-sm text-slate-500">This invoice may have been removed.</p>
              </div>
            ) : (
              <div className="space-y-5">

                {/* ── Header card ─────────────────────────────────────────── */}
                <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)]">
                        <ReceiptText className="h-7 w-7" />
                      </div>
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                            {detail.invoiceNumber}
                          </h1>
                          <InvoiceStatusBadge status={detail.status} />
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                          {detail.client && (
                            <span className="flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5" />
                              {detail.client.name}
                            </span>
                          )}
                          {detail.loadId && (
                            <span className="flex items-center gap-1.5">
                              <Package className="h-3.5 w-3.5" />
                              Load #{detail.loadId}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            {fmtDate(detail.submittedAt ?? detail.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invoice Amount</p>
                        <p className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                          {fmtCurrency(detail.amount)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Quick stats row */}
                  <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 sm:grid-cols-4 dark:divide-slate-800 dark:border-slate-800">
                    {[
                      { label: "Advance",    value: detail.payout ? fmtCurrency(detail.payout.advanceAmount) : "—",  tint: "violet" },
                      { label: "Fee",        value: detail.payout ? fmtCurrency(detail.payout.feeAmount)    : "—",  tint: "amber"  },
                      { label: "Reserve",    value: detail.payout ? fmtCurrency(detail.payout.reserveAmount): "—",  tint: "blue"   },
                      { label: "Documents",  value: String(detail.documents?.length ?? 0),                           tint: "slate"  },
                    ].map(({ label, value, tint }) => (
                      <div key={label} className="p-4 text-center">
                        <p className={cn(
                          "text-xl font-semibold",
                          tint === "violet" && "text-violet-600 dark:text-violet-400",
                          tint === "amber"  && "text-amber-600 dark:text-amber-400",
                          tint === "blue"   && "text-blue-600 dark:text-blue-400",
                          tint === "slate"  && "text-slate-700 dark:text-slate-300",
                        )}>
                          {value}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Stage pipeline ───────────────────────────────────────── */}
                <div className="rounded-[24px] border border-slate-200/80 bg-white/90 px-6 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <div className="mb-4 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-slate-700 dark:text-white">Factoring Lifecycle</h2>
                    <span className="ml-auto rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                      Stage {FACTORING_STAGES.indexOf(currentStage) + 1} of 8 · {STAGE_META[currentStage]?.label}
                    </span>
                  </div>
                  <StagePipeline current={currentStage} />
                </div>

                {/* ── Tabs ─────────────────────────────────────────────────── */}
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <Tabs defaultValue="overview">
                    <div className="border-b border-slate-100 px-6 pt-5 dark:border-slate-800">
                      <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                        {[
                          { value: "overview",   label: "Overview",     icon: <ReceiptText className="h-3.5 w-3.5" /> },
                          { value: "documents",  label: "Documents",    icon: <FileText className="h-3.5 w-3.5" />,   count: detail.documents?.length },
                          { value: "payout",     label: "Payout",       icon: <Banknote className="h-3.5 w-3.5" /> },
                          { value: "collections",label: "Collections",  icon: <CreditCard className="h-3.5 w-3.5" />, count: detail.collections?.length },
                          { value: "cashapp",    label: "Cash Applied", icon: <DollarSign className="h-3.5 w-3.5" />, count: detail.cashAppLines?.length },
                          { value: "exceptions", label: "Exceptions",   icon: <ShieldAlert className="h-3.5 w-3.5" />,count: detail.exceptions?.length },
                          { value: "timeline",   label: "Timeline",     icon: <Activity className="h-3.5 w-3.5" /> },
                        ].map(({ value, label, icon, count }) => (
                          <TabsTrigger
                            key={value}
                            value={value}
                            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-3 pt-1 text-xs font-semibold text-slate-500 transition-colors data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 dark:text-slate-400 dark:data-[state=active]:text-blue-300"
                          >
                            {icon}{label}
                            {!!count && count > 0 && (
                              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {count}
                              </span>
                            )}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>

                    {/* Overview */}
                    <TabsContent value="overview" className="p-6">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        {/* Invoice fields */}
                        <div className="space-y-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Invoice Details</h3>
                          {[
                            { label: "Invoice #",        value: detail.invoiceNumber },
                            { label: "Load #",           value: detail.loadNumber || (detail.loadId ? `#${detail.loadId}` : "—") },
                            { label: "Amount",           value: fmtCurrency(detail.amount) },
                            { label: "Invoice Date",     value: fmtDate(detail.invoiceDate) },
                            { label: "Due Date",         value: fmtDate(detail.dueDate) },
                            { label: "BOL Number",       value: detail.bolNumber || "—" },
                            { label: "Load Type",        value: detail.loadType?.replace(/_/g, " ") || "—" },
                            { label: "Pickup",           value: detail.pickupLocation || "—" },
                            { label: "Delivery",         value: detail.deliveryLocation || "—" },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                              <span className="text-xs font-medium text-slate-400">{label}</span>
                              <span className="text-right text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</span>
                            </div>
                          ))}
                        </div>
                        {/* Client + debtor */}
                        <div className="space-y-5">
                          {detail.client && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Carrier / Client</h3>
                              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                                <div className="mb-1 flex items-center gap-2">
                                  <User className="h-4 w-4 text-blue-500" />
                                  <span className="font-semibold text-slate-800 dark:text-white">{detail.client.name}</span>
                                </div>
                                <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {detail.client.email && <p>{detail.client.email}</p>}
                                  {detail.client.phone && <p>{detail.client.phone}</p>}
                                  {detail.client.mcNumber && <p>MC# {detail.client.mcNumber}</p>}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/clients`)}
                                  className="mt-2 h-7 gap-1 rounded-lg px-2 text-[11px] text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/20"
                                >
                                  <ExternalLink className="h-3 w-3" />View Client
                                </Button>
                              </div>
                            </div>
                          )}
                          {detail.debtor && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Debtor / Broker</h3>
                              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                                <div className="mb-1 flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-violet-500" />
                                  <span className="font-semibold text-slate-800 dark:text-white">{detail.debtor.name}</span>
                                </div>
                                <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {detail.debtor.email && <p>{detail.debtor.email}</p>}
                                  {detail.debtor.mcNumber && <p>MC# {detail.debtor.mcNumber}</p>}
                                  {detail.debtor.creditLimit && <p>Credit limit: {fmtCurrency(detail.debtor.creditLimit)}</p>}
                                </div>
                              </div>
                            </div>
                          )}
                          {detail.notes && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Notes</h3>
                              <p className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                                {detail.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    {/* Documents */}
                    <TabsContent value="documents" className="p-6">
                      {!detail.documents?.length ? (
                        <EmptyTabState icon={<FileText className="h-7 w-7" />} label="No documents uploaded for this invoice" />
                      ) : (
                        <div className="space-y-2">
                          {detail.documents.map((doc: any) => (
                            <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="flex items-center gap-3">
                                <FileCheck className="h-5 w-5 shrink-0 text-blue-500" />
                                <div>
                                  <p className="text-sm font-medium text-slate-800 dark:text-white">{doc.originalName}</p>
                                  <p className="text-xs text-slate-400">{doc.documentType.replace(/_/g, " ")} · {(doc.size / 1024).toFixed(1)} KB</p>
                                </div>
                              </div>
                              <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px]",
                                doc.status === "processed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
                              )}>
                                {doc.status}
                              </Badge>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/documents")}
                              className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Documents
                            </Button>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Payout */}
                    <TabsContent value="payout" className="p-6">
                      {!detail.payout ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                            <Banknote className="h-7 w-7" />
                          </div>
                          <p className="mb-3 text-sm font-medium text-slate-500">No payout record yet</p>
                          <Button variant="outline" size="sm" onClick={() => navigate("/payouts")}
                            className="gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Payouts
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            {[
                              { label: "Invoice Amount", value: fmtCurrency(detail.payout.invoiceAmount), tint: "slate" },
                              { label: "Advance Rate",   value: `${detail.payout.advanceRate}%`,           tint: "blue"   },
                              { label: "Advance Amount", value: fmtCurrency(detail.payout.advanceAmount),  tint: "violet" },
                              { label: "Fee Rate",       value: `${detail.payout.feeRate}%`,               tint: "amber"  },
                              { label: "Fee Amount",     value: fmtCurrency(detail.payout.feeAmount),      tint: "amber"  },
                              { label: "Net Payout",     value: fmtCurrency(detail.payout.netPayout),      tint: "emerald"},
                              { label: "Reserve",        value: fmtCurrency(detail.payout.reserveAmount),  tint: "teal"   },
                            ].map(({ label, value, tint }) => (
                              <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                                <p className="mb-1 text-xs text-slate-400">{label}</p>
                                <p className={cn("text-lg font-semibold",
                                  tint === "emerald" && "text-emerald-600 dark:text-emerald-400",
                                  tint === "violet"  && "text-violet-600 dark:text-violet-400",
                                  tint === "blue"    && "text-blue-600 dark:text-blue-400",
                                  tint === "amber"   && "text-amber-600 dark:text-amber-400",
                                  tint === "teal"    && "text-teal-600 dark:text-teal-400",
                                  tint === "slate"   && "text-slate-700 dark:text-slate-200",
                                )}>
                                  {value}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                            <span className="text-sm text-slate-500">Payout Status</span>
                            <Badge className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                              {detail.payout.paymentStatus?.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          {detail.payout.notes && (
                            <p className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                              {detail.payout.notes}
                            </p>
                          )}
                          <Button variant="outline" size="sm" onClick={() => navigate("/payouts")}
                            className="gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Manage in Payouts
                          </Button>
                        </div>
                      )}
                    </TabsContent>

                    {/* Collections */}
                    <TabsContent value="collections" className="p-6">
                      {!detail.collections?.length ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <EmptyTabState icon={<CreditCard className="h-7 w-7" />} label="No collection records linked to this invoice" />
                          <Button variant="outline" size="sm" onClick={() => navigate("/collections")}
                            className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Collections
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {detail.collections.map((c: any) => (
                            <div key={c.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="font-semibold text-slate-800 dark:text-white">{c.description}</p>
                                  <p className="text-xs text-slate-400">Due {fmtDate(c.dueDate)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="font-semibold text-slate-900 dark:text-white">{fmtCurrency(c.amount)}</p>
                                  <div className="flex gap-1 mt-1 justify-end">
                                    <Badge className="rounded-full border px-2 py-0 text-[10px] border-orange-200 bg-orange-50 text-orange-700">
                                      {c.priority}
                                    </Badge>
                                    <Badge className="rounded-full border px-2 py-0 text-[10px] border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                      {c.status}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/collections")}
                              className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Collections
                            </Button>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Cash Application */}
                    <TabsContent value="cashapp" className="p-6">
                      {!detail.cashAppLines?.length ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <EmptyTabState icon={<DollarSign className="h-7 w-7" />} label="No payments applied to this invoice yet" />
                          <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")}
                            className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Cash Application
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {detail.cashAppLines.map((l: any) => (
                            <div key={l.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">
                                    Applied: {fmtCurrency(l.appliedAmount)}
                                  </p>
                                  <p className="text-xs text-slate-400">Invoice total: {fmtCurrency(l.invoiceAmount)}</p>
                                  {l.varianceReason && (
                                    <p className="text-xs text-slate-500 mt-0.5">{l.varianceReason}</p>
                                  )}
                                </div>
                                <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                                  l.varianceType === "full_match"  ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                                  l.varianceType === "short_pay"   ? "border-amber-200 bg-amber-50 text-amber-700" :
                                  l.varianceType === "overpay"     ? "border-blue-200 bg-blue-50 text-blue-700" :
                                  "border-slate-200 bg-slate-50 text-slate-600"
                                )}>
                                  {l.varianceType?.replace(/_/g, " ")}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")}
                              className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Cash Application
                            </Button>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Exceptions */}
                    <TabsContent value="exceptions" className="p-6">
                      {!detail.exceptions?.length ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <EmptyTabState icon={<ShieldAlert className="h-7 w-7" />} label="No exceptions on this invoice" />
                          <Button variant="outline" size="sm" onClick={() => navigate("/exceptions")}
                            className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Exceptions
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {detail.exceptions.map((e: any) => (
                            <div key={e.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{e.title}</p>
                                  {e.description && <p className="text-xs text-slate-400 mt-0.5">{e.description}</p>}
                                  <p className="text-xs text-slate-400 mt-0.5">{e.type?.replace(/_/g, " ")}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                                    e.severity === "critical" ? "border-red-300 bg-red-50 text-red-700" :
                                    e.severity === "high"     ? "border-orange-200 bg-orange-50 text-orange-700" :
                                    e.severity === "medium"   ? "border-amber-200 bg-amber-50 text-amber-700" :
                                    "border-slate-200 bg-slate-50 text-slate-600"
                                  )}>
                                    {e.severity}
                                  </Badge>
                                  <Badge className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                    {e.status}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/exceptions")}
                              className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Exceptions
                            </Button>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Timeline */}
                    <TabsContent value="timeline" className="p-6">
                      {timelineLoading ? (
                        <div className="space-y-3">
                          {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
                        </div>
                      ) : !timeline?.length ? (
                        <EmptyTabState icon={<Activity className="h-7 w-7" />} label="No activity recorded yet" />
                      ) : (
                        <div className="relative space-y-0">
                          {/* Vertical line */}
                          <div className="absolute left-[26px] top-4 bottom-4 w-px bg-slate-100 dark:bg-slate-800" />
                          {timeline.map((event: any, idx: number) => (
                            <div key={event.id} className="relative flex gap-4 pb-5">
                              <div className="relative z-10 mt-0.5 shrink-0">
                                <TimelineIcon category={event.category} />
                              </div>
                              <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{event.title}</p>
                                  <time className="shrink-0 text-[11px] text-slate-400">
                                    {event.timestamp ? new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                                  </time>
                                </div>
                                {event.description && (
                                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{event.description}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>

              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, CheckCircle2, Circle, FileText, DollarSign, AlertTriangle,
  CreditCard, Clock, TrendingUp, Package, User, Building2, Calendar,
  ExternalLink, FileCheck, ReceiptText, Banknote, ShieldAlert, Activity,
  ChevronRight, ArrowRight, Lock, TriangleAlert, Zap, XCircle, Info,
  PlayCircle, ClipboardCheck, MessageSquare,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import DocumentIntakeZone from "@/components/documents/document-intake-zone";

// ─── Stage constants ───────────────────────────────────────────────────────────

const FACTORING_STAGES = [
  "document_intake","verification","approval","advance",
  "collections","payment_receipt","reconciliation","final_settlement",
] as const;
type FactoringStage = (typeof FACTORING_STAGES)[number];
const STAGE_META: Record<FactoringStage, { label: string; description: string }> = {
  document_intake:  { label: "Document Intake",  description: "Receiving carrier documents"       },
  verification:     { label: "Verification",      description: "Docs, credit & broker checks"      },
  approval:         { label: "Approval",          description: "Factor review & funding decision"  },
  advance:          { label: "Advance",           description: "Advance sent to carrier"           },
  collections:      { label: "Collections",       description: "Collecting from broker/debtor"     },
  payment_receipt:  { label: "Payment Receipt",   description: "Payment received"                  },
  reconciliation:   { label: "Reconciliation",    description: "Matching payment to balance"       },
  final_settlement: { label: "Final Settlement",  description: "Reserve released — fully settled" },
};

// ─── Transition type ──────────────────────────────────────────────────────────

interface AvailableTransition {
  id: string;
  label: string;
  description: string;
  to: string;
  variant: "primary" | "secondary" | "danger";
  blocked: boolean;
  warnOnly: boolean;
  blockers: Array<{ code: string; message: string; severity: "error" | "warning" }>;
  requiresReason: boolean;
}

// ─── Stage pipeline ───────────────────────────────────────────────────────────

function StagePipeline({ current }: { current: FactoringStage }) {
  const currentIdx = FACTORING_STAGES.indexOf(current);
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[700px] items-start gap-0 py-2">
        {FACTORING_STAGES.map((stage, idx) => {
          const done   = idx < currentIdx;
          const active = idx === currentIdx;
          const meta   = STAGE_META[stage];
          const isLast = idx === FACTORING_STAGES.length - 1;
          return (
            <div key={stage} className="flex flex-1 items-start">
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div className="relative flex w-full items-center">
                  <div className={cn("h-0.5 flex-1", idx === 0 ? "invisible" : done || active ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700")} />
                  <div className={cn(
                    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                    done   && "border-blue-500 bg-blue-500 text-white",
                    active && "border-blue-600 bg-blue-600 text-white shadow-[0_0_0_4px_rgba(37,99,235,0.18)]",
                    !done && !active && "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500",
                  )}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <span className="text-[11px] font-bold">{idx + 1}</span> : <Circle className="h-3 w-3" />}
                  </div>
                  <div className={cn("h-0.5 flex-1", isLast ? "invisible" : done ? "bg-blue-500" : "bg-slate-200 dark:bg-slate-700")} />
                </div>
                <div className="flex flex-col items-center gap-0.5 text-center">
                  <span className={cn("text-[11px] font-semibold leading-tight",
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

// ─── Status badge ─────────────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved:     "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    paid:         "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    funded:       "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300",
    submitted:    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
    under_review: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
    docs_pending: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300",
    rejected:     "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
    settled:      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-300",
    draft:        "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold shadow-sm", colors[status] ?? colors.draft)}>
      {status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
    </Badge>
  );
}

// ─── Timeline icon ────────────────────────────────────────────────────────────

function TimelineIcon({ category }: { category: string }) {
  const s: Record<string, { icon: React.ReactNode; bg: string }> = {
    stage:      { icon: <TrendingUp className="h-3.5 w-3.5" />,    bg: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" },
    status:     { icon: <Activity className="h-3.5 w-3.5" />,      bg: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
    document:   { icon: <FileText className="h-3.5 w-3.5" />,      bg: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" },
    payout:     { icon: <Banknote className="h-3.5 w-3.5" />,      bg: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300" },
    payment:    { icon: <DollarSign className="h-3.5 w-3.5" />,    bg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" },
    collection: { icon: <CreditCard className="h-3.5 w-3.5" />,    bg: "bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300" },
    exception:  { icon: <AlertTriangle className="h-3.5 w-3.5" />, bg: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300" },
    system:     { icon: <Clock className="h-3.5 w-3.5" />,         bg: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  };
  const entry = s[category] ?? s.system;
  return (
    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", entry.bg)}>
      {entry.icon}
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

// ─── Lifecycle Actions Card ───────────────────────────────────────────────────

function LifecycleActionsCard({
  invoiceId,
  transitions,
  isLoading,
  userRole,
  onTransition,
}: {
  invoiceId: number;
  transitions: AvailableTransition[];
  isLoading: boolean;
  userRole: string;
  onTransition: (t: AvailableTransition) => void;
}) {
  const isAdmin = userRole === "admin" || userRole === "manager";

  if (isLoading) return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/90 p-5 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <Skeleton className="h-5 w-48 mb-4" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-40 rounded-2xl" />
        <Skeleton className="h-10 w-40 rounded-2xl" />
      </div>
    </div>
  );

  if (!transitions.length) return null;

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <Zap className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-700 dark:text-white">Lifecycle Actions</h2>
        <span className="ml-auto text-xs text-slate-400">{transitions.length} available</span>
      </div>

      <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
        {transitions.map((t) => {
          const isHardBlocked = t.blocked;
          const isSoftBlocked = t.warnOnly;
          const canForce      = isSoftBlocked && isAdmin;

          return (
            <div key={t.id} className={cn(
              "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between",
              isHardBlocked && "opacity-60",
            )}>
              {/* Left: description */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-white">{t.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    → {t.to.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.description}</p>

                {/* Blockers */}
                {t.blockers.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {t.blockers.map((b) => (
                      <div key={b.code} className={cn(
                        "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                        b.severity === "error"
                          ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300",
                      )}>
                        {b.severity === "error"
                          ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          : <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
                        {b.message}
                      </div>
                    ))}
                    {canForce && (
                      <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700 dark:bg-blue-950/20 dark:text-blue-300">
                        <Info className="h-3 w-3 shrink-0" />
                        Admin override available — you can still proceed
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right: action button */}
              <div className="shrink-0">
                {isHardBlocked ? (
                  <Button disabled size="sm" variant="outline"
                    className="gap-1.5 rounded-2xl border-slate-200 text-xs opacity-50 dark:border-slate-700">
                    <Lock className="h-3 w-3" />Blocked
                  </Button>
                ) : t.variant === "danger" ? (
                  <Button
                    size="sm"
                    onClick={() => onTransition(t)}
                    className="gap-1.5 rounded-2xl bg-red-600 text-xs text-white shadow-sm hover:bg-red-700"
                  >
                    <XCircle className="h-3 w-3" />{t.label}
                  </Button>
                ) : t.variant === "primary" ? (
                  <Button
                    size="sm"
                    onClick={() => onTransition(t)}
                    className={cn(
                      "gap-1.5 rounded-2xl text-xs text-white shadow-sm",
                      canForce
                        ? "bg-amber-500 hover:bg-amber-600 shadow-[0_4px_12px_rgba(245,158,11,0.25)]"
                        : "bg-blue-600 hover:bg-blue-700 shadow-[0_4px_12px_rgba(37,99,235,0.22)]",
                    )}
                  >
                    <PlayCircle className="h-3 w-3" />{t.label}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTransition(t)}
                    className="gap-1.5 rounded-2xl border-slate-200 text-xs dark:border-slate-700"
                  >
                    <ArrowRight className="h-3 w-3" />{t.label}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Transition dialog ────────────────────────────────────────────────────────

function TransitionDialog({
  transition,
  open,
  onClose,
  onConfirm,
  isPending,
  isAdmin,
}: {
  transition: AvailableTransition | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, force: boolean) => void;
  isPending: boolean;
  isAdmin: boolean;
}) {
  const [reason, setReason] = useState("");
  const [force,  setForce]  = useState(false);

  if (!transition) return null;

  const needsReason = transition.requiresReason;
  const hasSoftWarn = transition.warnOnly;
  const canSubmit   = !needsReason || reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setReason(""); setForce(false); } }}>
      <DialogContent className="max-w-md rounded-3xl border-slate-200 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
            {transition.variant === "danger"
              ? <XCircle className="h-5 w-5 text-red-500" />
              : <PlayCircle className="h-5 w-5 text-blue-500" />}
            {transition.label}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Confirm lifecycle transition: {transition.label}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <p className="text-sm text-slate-500 dark:text-slate-400">{transition.description}</p>

          {/* Soft-block warnings */}
          {hasSoftWarn && (
            <div className="space-y-1.5">
              {transition.blockers.map((b) => (
                <div key={b.code} className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {b.message}
                </div>
              ))}
            </div>
          )}

          {/* Reason input */}
          {needsReason && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Reason <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  transition.id === "reject" ? "Explain why this invoice is being rejected..."
                  : transition.id === "request_docs" ? "Describe which documents are missing..."
                  : "Provide a reason for this action..."
                }
                rows={3}
                className="rounded-xl border-slate-200 text-sm dark:border-slate-700"
              />
            </div>
          )}

          {/* Admin force override */}
          {hasSoftWarn && isAdmin && (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)}
                className="h-4 w-4 rounded accent-amber-500" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Admin override — proceed despite warnings
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}
            className="rounded-xl text-xs">Cancel</Button>
          <Button
            size="sm"
            disabled={isPending || !canSubmit || (hasSoftWarn && !force && isAdmin)}
            onClick={() => onConfirm(reason, force)}
            className={cn(
              "rounded-xl text-xs text-white",
              transition.variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {isPending ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invoiceId = Number(id);

  const [selectedTransition, setSelectedTransition] = useState<AvailableTransition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewNotes,  setReviewNotes]  = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved"|"needs_revision"|"incomplete">("needs_revision");

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

  const { data: transitions = [], isLoading: transitionsLoading } = useQuery<AvailableTransition[]>({
    queryKey: ["/api/invoices", invoiceId, "available-transitions"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/available-transitions`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !isNaN(invoiceId),
    refetchOnMount: "always",
  });

  const { data: docStatus, isLoading: docStatusLoading } = useQuery<any>({
    queryKey: ["/api/invoices", invoiceId, "document-status"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/document-status`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !isNaN(invoiceId),
    refetchOnMount: "always",
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ status, notes }: { status: string; notes: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/doc-reviews`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Review note saved" });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
      setReviewNotes(""); setReviewStatus("needs_revision");
    },
    onError: () => toast({ title: "Error saving note", variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ transitionId, reason, force }: { transitionId: string; reason?: string; force?: boolean }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/transition`, { transitionId, reason, force });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Transition applied", description: `Invoice moved to: ${data.invoice?.status?.replace(/_/g, " ")}` });
        qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
        qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "timeline"] });
        qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] });
        qc.invalidateQueries({ queryKey: ["/api/invoices"] });
        qc.invalidateQueries({ queryKey: ["/api/payouts"] });
      } else {
        toast({
          title: "Transition blocked",
          description: data.error ?? "Could not apply this transition",
          variant: "destructive",
        });
      }
      setDialogOpen(false);
      setSelectedTransition(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to apply transition", variant: "destructive" });
    },
  });

  const openTransitionDialog = (t: AvailableTransition) => {
    setSelectedTransition(t);
    // If no reason required and no warnings, fire directly
    if (!t.requiresReason && !t.warnOnly) {
      transitionMutation.mutate({ transitionId: t.id });
    } else {
      setDialogOpen(true);
    }
  };

  const confirmTransition = (reason: string, force: boolean) => {
    if (!selectedTransition) return;
    transitionMutation.mutate({ transitionId: selectedTransition.id, reason: reason || undefined, force });
  };

  const currentStage = (detail?.factoringStage ?? "document_intake") as FactoringStage;
  const fmtCurrency = (v: string | number | null | undefined) =>
    v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (v: string | Date | null | undefined) =>
    v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const isAdmin = user?.role === "admin" || user?.role === "manager";

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.06),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Load Detail" subtitle="Full factoring lifecycle — documents, status, and funding timeline" group="Workspace" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">

            <Button variant="ghost" onClick={() => navigate("/invoices")}
              className="mb-5 -ml-2 gap-2 rounded-xl text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
              <ArrowLeft className="h-4 w-4" />Back to Invoices
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
              </div>
            ) : (
              <div className="space-y-5">

                {/* ── Header card ────────────────────────────────────────── */}
                <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.28)]">
                        <ReceiptText className="h-7 w-7" />
                      </div>
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{detail.invoiceNumber}</h1>
                          <InvoiceStatusBadge status={detail.status} />
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                          {detail.client && <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{detail.client.name}</span>}
                          {detail.loadId && <span className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />Load #{detail.loadId}</span>}
                          <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{fmtDate(detail.submittedAt ?? detail.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invoice Amount</p>
                      <p className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{fmtCurrency(detail.amount)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 sm:grid-cols-4 dark:divide-slate-800 dark:border-slate-800">
                    {[
                      { label: "Advance",   value: detail.payout ? fmtCurrency(detail.payout.advanceAmount) : "—", tint: "violet" },
                      { label: "Fee",       value: detail.payout ? fmtCurrency(detail.payout.feeAmount)     : "—", tint: "amber"  },
                      { label: "Reserve",   value: detail.payout ? fmtCurrency(detail.payout.reserveAmount) : "—", tint: "blue"   },
                      { label: "Documents", value: String(detail.documents?.length ?? 0),                           tint: "slate"  },
                    ].map(({ label, value, tint }) => (
                      <div key={label} className="p-4 text-center">
                        <p className={cn("text-xl font-semibold",
                          tint === "violet" && "text-violet-600 dark:text-violet-400",
                          tint === "amber"  && "text-amber-600 dark:text-amber-400",
                          tint === "blue"   && "text-blue-600 dark:text-blue-400",
                          tint === "slate"  && "text-slate-700 dark:text-slate-300",
                        )}>{value}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Stage pipeline ─────────────────────────────────────── */}
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

                {/* ── Lifecycle actions ──────────────────────────────────── */}
                <LifecycleActionsCard
                  invoiceId={invoiceId}
                  transitions={transitions}
                  isLoading={transitionsLoading}
                  userRole={user?.role ?? "employee"}
                  onTransition={openTransitionDialog}
                />

                {/* ── Tabs ──────────────────────────────────────────────── */}
                <div className="rounded-[28px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <Tabs defaultValue="overview">
                    <div className="border-b border-slate-100 px-6 pt-5 dark:border-slate-800">
                      <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                        {[
                          { value: "overview",    label: "Overview",      icon: <ReceiptText className="h-3.5 w-3.5" /> },
                          { value: "doccheck",    label: "Doc Checklist", icon: <ClipboardCheck className="h-3.5 w-3.5" />, alert: docStatus && !docStatus.canApprove },
                          { value: "documents",   label: "Documents",     icon: <FileText className="h-3.5 w-3.5" />,    count: detail.documents?.length },
                          { value: "payout",      label: "Payout",        icon: <Banknote className="h-3.5 w-3.5" /> },
                          { value: "collections", label: "Collections",   icon: <CreditCard className="h-3.5 w-3.5" />,  count: detail.collections?.length },
                          { value: "cashapp",     label: "Cash Applied",  icon: <DollarSign className="h-3.5 w-3.5" />,  count: detail.cashAppLines?.length },
                          { value: "exceptions",  label: "Exceptions",    icon: <ShieldAlert className="h-3.5 w-3.5" />, count: detail.exceptions?.length },
                          { value: "timeline",    label: "Timeline",      icon: <Activity className="h-3.5 w-3.5" /> },
                        ].map(({ value, label, icon, count, alert }: any) => (
                          <TabsTrigger key={value} value={value}
                            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-3 pt-1 text-xs font-semibold text-slate-500 transition-colors data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 dark:text-slate-400 dark:data-[state=active]:text-blue-300">
                            {icon}{label}
                            {!!count && count > 0 && (
                              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>
                            )}
                            {alert && (
                              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                            )}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>

                    {/* Doc Checklist */}
                    <TabsContent value="doccheck" className="p-6">
                      {docStatusLoading ? (
                        <div className="space-y-3">
                          {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
                        </div>
                      ) : !docStatus ? (
                        <p className="text-sm text-slate-400">No checklist data available.</p>
                      ) : (
                        <div className="space-y-5">
                          {/* Overall progress bar */}
                          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <ClipboardCheck className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-semibold text-slate-800 dark:text-white">Overall Completeness</span>
                              </div>
                              <span className={cn(
                                "rounded-full px-3 py-1 text-xs font-bold",
                                docStatus.canApprove
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              )}>
                                {docStatus.completenessPercent ?? 0}% complete
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className={cn("h-full rounded-full transition-all duration-500",
                                  (docStatus.completenessPercent ?? 0) === 100 ? "bg-emerald-500" : "bg-blue-500"
                                )}
                                style={{ width: `${docStatus.completenessPercent ?? 0}%` }}
                              />
                            </div>
                            <div className="mt-3 flex flex-wrap gap-3">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className={cn("font-semibold", docStatus.canStartReview ? "text-emerald-600" : "text-red-500")}>
                                  {docStatus.canStartReview ? "✓" : "✗"}
                                </span>
                                Ready to Begin Review
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span className={cn("font-semibold", docStatus.canApprove ? "text-emerald-600" : "text-red-500")}>
                                  {docStatus.canApprove ? "✓" : "✗"}
                                </span>
                                Ready for Approval
                              </div>
                            </div>
                          </div>

                          {/* Missing docs warnings */}
                          {(docStatus.missingForReview?.length > 0 || docStatus.missingForApproval?.length > 0) && (
                            <div className="space-y-2">
                              {docStatus.missingForReview?.length > 0 && (
                                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                  <div>
                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Missing for Review</p>
                                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                                      {docStatus.missingForReview.join(", ")}
                                    </p>
                                  </div>
                                </div>
                              )}
                              {docStatus.missingForApproval?.length > 0 && (
                                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
                                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                                  <div>
                                    <p className="text-xs font-semibold text-red-800 dark:text-red-300">Missing for Approval</p>
                                    <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
                                      {docStatus.missingForApproval.join(", ")}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* All-clear banner */}
                          {docStatus.canApprove && (
                            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                All required documents are present. This invoice can proceed to approval.
                              </p>
                            </div>
                          )}

                          {/* Per-rule breakdown */}
                          {docStatus.rules?.length > 0 && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                              <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Document Requirements</h3>
                              </div>
                              <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                                {docStatus.rules.map((rule: any) => (
                                  <div key={rule.documentType} className="flex items-center gap-3 px-5 py-3.5">
                                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-xl",
                                      rule.present
                                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                                        : rule.required
                                          ? "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                                          : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                                    )}>
                                      {rule.present
                                        ? <CheckCircle2 className="h-4 w-4" />
                                        : rule.required
                                          ? <XCircle className="h-4 w-4" />
                                          : <Circle className="h-3.5 w-3.5" />
                                      }
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-xs font-semibold text-slate-800 dark:text-white">{rule.label}</span>
                                        {rule.required ? (
                                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-400">Required</span>
                                        ) : (
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400 dark:bg-slate-800">Optional</span>
                                        )}
                                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                          rule.requiredForStage === "approve"
                                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                                            : "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
                                        )}>
                                          {rule.requiredForStage === "approve" ? "For Approval" : "For Review"}
                                        </span>
                                      </div>
                                      {rule.description && (
                                        <p className="mt-0.5 text-[11px] text-slate-400">{rule.description}</p>
                                      )}
                                    </div>
                                    <span className={cn("shrink-0 text-xs font-semibold",
                                      rule.present ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                                    )}>
                                      {rule.present ? "Uploaded" : "Missing"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Reviewer notes (manager/admin only) */}
                          {(user?.role === "manager" || user?.role === "admin") && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                              <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="h-4 w-4 text-violet-600" />
                                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">Reviewer Notes</h3>
                                </div>
                              </div>

                              {/* Previous reviews */}
                              {docStatus.reviews?.length > 0 && (
                                <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                                  {docStatus.reviews.map((rev: any, idx: number) => (
                                    <div key={idx} className="px-5 py-3.5">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                                          rev.status === "approved"
                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                            : rev.status === "needs_revision"
                                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                                              : "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                                        )}>
                                          {rev.status === "approved" ? "Approved" : rev.status === "needs_revision" ? "Needs Revision" : "Incomplete"}
                                        </span>
                                        <span className="text-[11px] text-slate-400">
                                          {rev.reviewedBy} · {rev.reviewedAt ? new Date(rev.reviewedAt).toLocaleString() : ""}
                                        </span>
                                      </div>
                                      {rev.notes && <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">{rev.notes}</p>}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add new review note */}
                              <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                                <p className="mb-3 text-xs font-semibold text-slate-600 dark:text-slate-300">Add Review Note</p>
                                <div className="space-y-3">
                                  <Select value={reviewStatus} onValueChange={(v: any) => setReviewStatus(v)}>
                                    <SelectTrigger className="rounded-xl border-slate-200 text-xs dark:border-slate-700">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="approved">Approved — all documents acceptable</SelectItem>
                                      <SelectItem value="needs_revision">Needs Revision — documents need correction</SelectItem>
                                      <SelectItem value="incomplete">Incomplete — documents still missing</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <textarea
                                    value={reviewNotes}
                                    onChange={e => setReviewNotes(e.target.value)}
                                    rows={3}
                                    placeholder="Add notes for the submitter or your team..."
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                  />
                                  <Button
                                    size="sm"
                                    disabled={reviewMutation.isPending}
                                    onClick={() => reviewMutation.mutate({ status: reviewStatus, notes: reviewNotes })}
                                    className="gap-2 rounded-xl bg-violet-600 text-xs text-white hover:bg-violet-700"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    {reviewMutation.isPending ? "Saving..." : "Save Note"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </TabsContent>

                    {/* Overview */}
                    <TabsContent value="overview" className="p-6">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <div className="space-y-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Invoice Details</h3>
                          {[
                            { label: "Invoice #",    value: detail.invoiceNumber },
                            { label: "Load #",       value: detail.loadNumber || (detail.loadId ? `#${detail.loadId}` : "—") },
                            { label: "Amount",       value: fmtCurrency(detail.amount) },
                            { label: "Invoice Date", value: fmtDate(detail.invoiceDate) },
                            { label: "Due Date",     value: fmtDate(detail.dueDate) },
                            { label: "BOL Number",   value: detail.bolNumber || "—" },
                            { label: "Load Type",    value: detail.loadType?.replace(/_/g, " ") || "—" },
                            { label: "Pickup",       value: detail.pickupLocation || "—" },
                            { label: "Delivery",     value: detail.deliveryLocation || "—" },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                              <span className="text-xs font-medium text-slate-400">{label}</span>
                              <span className="text-right text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</span>
                            </div>
                          ))}
                        </div>
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
                                <Button variant="ghost" size="sm" onClick={() => navigate("/clients")}
                                  className="mt-2 h-7 gap-1 rounded-lg px-2 text-[11px] text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/20">
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
                              <p className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">{detail.notes}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    {/* Documents */}
                    <TabsContent value="documents" className="p-6">
                      <div className="space-y-6">
                        {/* Drag-and-drop intake zone */}
                        <div>
                          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Upload Documents
                          </h3>
                          <DocumentIntakeZone
                            entityType="invoice"
                            entityId={invoiceId}
                            onUploadComplete={() => {
                              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
                            }}
                          />
                        </div>

                        {/* Existing documents list */}
                        {!!detail.documents?.length && (
                          <div>
                            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              Uploaded Documents ({detail.documents.length})
                            </h3>
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
                                    doc.status === "processed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                                    {doc.status}
                                  </Badge>
                                </div>
                              ))}
                              <div className="pt-1">
                                <Button variant="outline" size="sm" onClick={() => navigate("/documents")} className="gap-1.5 rounded-xl text-xs">
                                  <ExternalLink className="h-3.5 w-3.5" />Manage in Documents
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* Payout */}
                    <TabsContent value="payout" className="p-6">
                      {!detail.payout ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <EmptyTabState icon={<Banknote className="h-7 w-7" />} label="No payout record yet — fund the invoice to auto-create one" />
                          <Button variant="outline" size="sm" onClick={() => navigate("/payouts")} className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Payouts
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                            {[
                              { label: "Invoice Amount", value: fmtCurrency(detail.payout.invoiceAmount), tint: "slate" },
                              { label: "Advance Rate",   value: `${detail.payout.advanceRate}%`,          tint: "blue"   },
                              { label: "Advance Amount", value: fmtCurrency(detail.payout.advanceAmount), tint: "violet" },
                              { label: "Fee Rate",       value: `${detail.payout.feeRate}%`,              tint: "amber"  },
                              { label: "Fee Amount",     value: fmtCurrency(detail.payout.feeAmount),     tint: "amber"  },
                              { label: "Net Payout",     value: fmtCurrency(detail.payout.netPayout),     tint: "emerald"},
                              { label: "Reserve",        value: fmtCurrency(detail.payout.reserveAmount), tint: "teal"   },
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
                                )}>{value}</p>
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
                            <p className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">{detail.payout.notes}</p>
                          )}
                          <Button variant="outline" size="sm" onClick={() => navigate("/payouts")} className="gap-1.5 rounded-xl text-xs">
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
                          <Button variant="outline" size="sm" onClick={() => navigate("/collections")} className="mt-2 gap-1.5 rounded-xl text-xs">
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
                                  <div className="mt-1 flex justify-end gap-1">
                                    <Badge className="rounded-full border px-2 py-0 text-[10px] border-orange-200 bg-orange-50 text-orange-700">{c.priority}</Badge>
                                    <Badge className="rounded-full border px-2 py-0 text-[10px] border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{c.status}</Badge>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/collections")} className="gap-1.5 rounded-xl text-xs">
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
                          <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")} className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Cash Application
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {detail.cashAppLines.map((l: any) => (
                            <div key={l.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">Applied: {fmtCurrency(l.appliedAmount)}</p>
                                  <p className="text-xs text-slate-400">Invoice total: {fmtCurrency(l.invoiceAmount)}</p>
                                  {l.varianceReason && <p className="mt-0.5 text-xs text-slate-500">{l.varianceReason}</p>}
                                </div>
                                <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                                  l.varianceType === "full_match" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                                  l.varianceType === "short_pay"  ? "border-amber-200 bg-amber-50 text-amber-700" :
                                  l.varianceType === "overpay"    ? "border-blue-200 bg-blue-50 text-blue-700" :
                                  "border-slate-200 bg-slate-50 text-slate-600")}>
                                  {l.varianceType?.replace(/_/g, " ")}
                                </Badge>
                              </div>
                            </div>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")} className="gap-1.5 rounded-xl text-xs">
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
                          <Button variant="outline" size="sm" onClick={() => navigate("/exceptions")} className="mt-2 gap-1.5 rounded-xl text-xs">
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
                                  {e.description && <p className="mt-0.5 text-xs text-slate-400">{e.description}</p>}
                                  <p className="mt-0.5 text-xs text-slate-400">{e.type?.replace(/_/g, " ")}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                                    e.severity === "critical" ? "border-red-300 bg-red-50 text-red-700" :
                                    e.severity === "high"     ? "border-orange-200 bg-orange-50 text-orange-700" :
                                    e.severity === "medium"   ? "border-amber-200 bg-amber-50 text-amber-700" :
                                    "border-slate-200 bg-slate-50 text-slate-600")}>
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
                            <Button variant="outline" size="sm" onClick={() => navigate("/exceptions")} className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Exceptions
                            </Button>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Timeline */}
                    <TabsContent value="timeline" className="p-6">
                      {timelineLoading ? (
                        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                      ) : !timeline?.length ? (
                        <EmptyTabState icon={<Activity className="h-7 w-7" />} label="No activity recorded yet" />
                      ) : (
                        <div className="relative space-y-0">
                          <div className="absolute left-[26px] top-4 bottom-4 w-px bg-slate-100 dark:bg-slate-800" />
                          {timeline.map((event: any) => (
                            <div key={event.id} className="relative flex gap-4 pb-5">
                              <div className="relative z-10 mt-0.5 shrink-0"><TimelineIcon category={event.category} /></div>
                              <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">{event.title}</p>
                                  <time className="shrink-0 text-[11px] text-slate-400">
                                    {event.timestamp ? new Date(event.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                                  </time>
                                </div>
                                {event.description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{event.description}</p>}
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

      {/* Transition dialog */}
      <TransitionDialog
        transition={selectedTransition}
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setSelectedTransition(null); }}
        onConfirm={confirmTransition}
        isPending={transitionMutation.isPending}
        isAdmin={isAdmin}
      />
    </div>
  );
}

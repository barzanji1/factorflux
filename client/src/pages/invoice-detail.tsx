import { useParams, useLocation } from "wouter";
import { PageInsights } from "@/components/PageInsights";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import ChargebackLifecycle from "@/components/invoices/chargeback-lifecycle";
import EntityNotes from "@/components/shared/EntityNotes";
import Sidebar from "@/components/layout/sidebar";
import { CompressionInfo } from "@/components/documents/compression-info";
import { documentClassification, documentClassificationLabel } from "@shared/document-display";
import TopNav from "@/components/layout/top-nav";
import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { Button as ButtonPrimitive } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input as InputPrimitive } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, CheckCircle2, Circle, FileText, DollarSign, AlertTriangle,
  CreditCard, Clock, TrendingUp, User, Building2, Calendar,
  ExternalLink, FileCheck, ReceiptText, Banknote, ShieldAlert, Activity,
  ChevronRight, ArrowRight, Lock, TriangleAlert, Zap, XCircle, Info,
  PlayCircle, ClipboardCheck, MessageSquare, Pencil, ShieldCheck,
  Eye, Download, Loader2, Upload,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import DocumentIntakeZone from "@/components/documents/document-intake-zone";
import DocumentReviewDialog from "@/components/documents/document-review-dialog";
import { LoadTypeBadge } from "@/components/load-type";
import BrokerConfirmationPanel from "@/components/broker-confirmation/invoice-panel";
import {
  NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuStatCard,
  NeuTab, NeuTabList, NeuTabPanel, NeuTabs, NeuTable, NeuTableBody, NeuTableCell,
  NeuTableHead, NeuTableHeader, NeuTableRow,
} from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { forwardRef, type ComponentProps } from "react";
import "./invoice-detail.css";

// Radix Select is deliberately retained for its current controlled Select value contract.
// NeuSelect is native HTML and would alter keyboard/portal semantics.

type LegacyButtonProps = ComponentProps<typeof ButtonPrimitive> & { primary?: boolean };
const Button = forwardRef<HTMLButtonElement, LegacyButtonProps>(
  ({ className, size = "default", variant = "default", primary, ...props }, ref) => (
    <NeuButton
      ref={ref}
      variant={primary ? "accent" : "default"}
      className={cn(
        size === "sm" && "min-h-9 px-3 py-1.5 text-xs",
        size === "lg" && "min-h-12 px-7 py-3 text-base",
        size === "icon" && "h-9 w-9 min-h-9 p-0",
        variant === "link" && "min-h-0 bg-transparent px-1 py-0 text-[#168c98] shadow-none underline-offset-4 hover:underline",
        variant === "ghost" && "shadow-none hover:bg-white/30",
        variant === "destructive" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "InvoiceNeuButton";

function Badge({ className, variant, ...props }: ComponentProps<typeof BadgePrimitive>) {
  const tone = variant === "destructive" ? "warning" : "neutral";
  return <NeuBadge tone={tone} className={className} {...props} />;
}

const Input = forwardRef<HTMLInputElement, ComponentProps<typeof InputPrimitive>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={className} {...props} />,
);
Input.displayName = "InvoiceNeuInput";

// ─── Stage constants ───────────────────────────────────────────────────────────

const FACTORING_STAGES = [
  "document_intake","verification","advance","approval",
  "collections","payment_receipt","reconciliation","final_settlement",
] as const;
type FactoringStage = (typeof FACTORING_STAGES)[number];
const STAGE_META: Record<FactoringStage, { label: string; description: string }> = {
  document_intake:  { label: "Document Intake",  description: "Receiving carrier documents"       },
  verification:     { label: "Verification",      description: "Docs, credit & broker checks"      },
  advance:          { label: "Advance",           description: "Advance sent to carrier"           },
  approval:         { label: "Approval",          description: "Internal factor funding review"    },
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

interface FundingReceipt {
  receiptNo: string;
  version: number;
  fundedAt?: string | null;
  createdAt?: string | null;
  paymentReference?: string | null;
  paymentMethod?: string | null;
  netFunded?: string | number | null;
}

// ─── Stage pipeline ───────────────────────────────────────────────────────────


// ─── Status badge ─────────────────────────────────────────────────────────────

function InvoiceStatusBadge({ status }: { status: string }) {
  const tone = ["approved", "paid", "settled"].includes(status) ? "success"
    : ["rejected", "docs_pending"].includes(status) ? "warning"
    : ["funded", "submitted"].includes(status) ? "accent" : "neutral";
  return (
    <NeuBadge tone={tone} className={status === "rejected" ? "text-red-700" : ""}>
      {status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
    </NeuBadge>
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#d4d0c8] py-1.5 last:border-0">
      <span className="text-xs text-[#666]">{label}</span>
      <span className="text-right text-xs font-semibold text-[#222]">{value}</span>
    </div>
  );
}

// ─── Lifecycle Actions Card ───────────────────────────────────────────────────

function LifecycleActionsCard({
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
    <NeuCard className="p-5">
      <Skeleton className="h-5 w-48 mb-4" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-40 rounded-2xl" />
        <Skeleton className="h-10 w-40 rounded-2xl" />
      </div>
    </NeuCard>
  );

  if (!transitions.length) return null;

  return (
    <NeuCard className="overflow-hidden">
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
            <NeuCard key={t.id} className={cn(
              "flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between",
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
                      <NeuNotice key={b.code} severity={b.severity === "error" ? "block" : "ack"} className="flex items-start gap-1.5 text-xs">
                        {b.severity === "error"
                          ? <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          : <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
                        {b.message}
                      </NeuNotice>
                    ))}
                    {canForce && (
                      <NeuNotice severity="info" className="flex items-center gap-1.5 text-xs">
                        <Info className="h-3 w-3 shrink-0" />
                        Admin override available — you can still proceed
                      </NeuNotice>
                    )}
                  </div>
                )}
              </div>

              {/* Right: action button */}
              <div className="shrink-0">
                {isHardBlocked ? (
                  <NeuBadge tone="warning" className="gap-1.5 text-red-700">
                    <Lock className="h-3 w-3" />Blocked
                  </NeuBadge>
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
            </NeuCard>
          );
        })}
      </div>
    </NeuCard>
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
      <DialogContent className="ff-invoice-neu-dialog max-w-md rounded-3xl border-slate-200 dark:border-slate-800">
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
                <NeuNotice key={b.code} severity="ack" className="flex items-start gap-2 text-xs">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {b.message}
                </NeuNotice>
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
  const { toast: showToast } = useToast();
  const toast = (options: Parameters<typeof showToast>[0]) => showToast({
    ...options, className: cn("ff-invoice-neu-toast", options.className),
  });
  const qc = useQueryClient();
  const invoiceId = Number(id);
  const isManager = user?.role === "manager" || user?.role === "admin";

  const [selectedTransition, setSelectedTransition] = useState<AvailableTransition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewNotes,  setReviewNotes]  = useState("");
  const [reviewStatus, setReviewStatus] = useState<"approved"|"needs_revision"|"incomplete">("needs_revision");
  const [reviewDocId, setReviewDocId] = useState<number | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [fundTransition, setFundTransition] = useState<AvailableTransition | null>(null);
  const [fundMethod, setFundMethod] = useState<"ach" | "wire" | "check">("ach");
  const [fundBankAccountId, setFundBankAccountId] = useState("");
  const [chargebackDialogOpen, setChargebackDialogOpen] = useState(false);
  const [chargebackExtensionDate, setChargebackExtensionDate] = useState("");
  const [chargebackReason, setChargebackReason] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [focusNoteId, setFocusNoteId] = useState<number | null>(null);
  const [uploadingDocumentType, setUploadingDocumentType] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [editValues, setEditValues] = useState({ amount: "", loadNumber: "", debtorId: "", brokerId: "", paymentType: "ACH", bankAccountId: "" });

  const { data: detail, isLoading: detailLoading } = useQuery<any>({
    queryKey: ["/api/invoices", invoiceId, "detail"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/detail`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch detail");
      return r.json();
    },
    enabled: !isNaN(invoiceId),
    refetchInterval: query => query.state.data?.status === "docs_pending" ? 2000 : false,
    refetchOnMount: "always",
  });
  const canonicalBroker = detail?.broker ?? detail?.debtor;
  const canAgentCorrect = !isManager && ["draft", "rejected"].includes(String(detail?.status ?? ""));
  const carrierId = detail?.client?.id ?? detail?.clientId;
  const { data: carrierBankAccounts = [], isLoading: bankAccountsLoading } = useQuery<any[]>({
    queryKey: ["/api/carriers", carrierId, "bank-accounts"],
    queryFn: async () => {
      const res = await fetch(`/api/carriers/${carrierId}/bank-accounts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load bank accounts");
      return res.json();
    },
    enabled: !!carrierId,
  });
  useEffect(() => {
    if (carrierBankAccounts.length === 1) setFundBankAccountId(String(carrierBankAccounts[0].id));
    if (carrierBankAccounts.length === 0) setFundBankAccountId("");
  }, [carrierBankAccounts]);
  useEffect(() => {
    if (editOpen && carrierBankAccounts.length === 1 && !editValues.bankAccountId) {
      setEditValues(v => ({ ...v, bankAccountId: String(carrierBankAccounts[0].id) }));
    }
  }, [editOpen, carrierBankAccounts, editValues.bankAccountId]);

  const { data: timeline, isLoading: timelineLoading } = useQuery<any[]>({
    queryKey: ["/api/invoices", invoiceId, "timeline"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/timeline`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch timeline");
      return r.json();
    },
    enabled: !isNaN(invoiceId),
  });

  const { data: receipts = [], isLoading: receiptsLoading } = useQuery<FundingReceipt[]>({
    queryKey: ["/api/invoices", invoiceId, "receipts"],
    queryFn: async () => {
      const r = await fetch(`/api/invoices/${invoiceId}/receipts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch funding receipts");
      return r.json();
    },
    enabled: !isNaN(invoiceId),
  });

  useEffect(() => {
    setPaymentReference(String(detail?.paymentReference ?? ""));
  }, [detail?.paymentReference]);

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

  const { data: preflight } = useQuery<{ alerts: { code: string; severity: string; title: string; message: string; link?: string }[] }>({
    queryKey: ["/api/invoices", invoiceId, "ocr-alerts"],
    queryFn: async () => (await apiRequest("GET", `/api/invoices/${invoiceId}/ocr-alerts`)).json(),
    enabled: !isNaN(invoiceId),
    refetchInterval: 5000,
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
    refetchInterval: detail?.status === "docs_pending" ? 2000 : false,
  });

  useEffect(() => {
    if (!detail?.status) return;
    setOverrideOpen(false);
    void qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
    void qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] });
    void qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "timeline"] });
  }, [qc, invoiceId, detail?.status]);

  const { data: brokers = [] } = useQuery<any[]>({
    queryKey: ["/api/brokers", "all"],
    queryFn: async () => {
      const response = await fetch("/api/brokers?all=true", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load brokers");
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : payload?.data;
      return Array.isArray(rows) ? rows : [];
    },
    enabled: editOpen,
  });

  const overrideMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/invoices/${invoiceId}/override-approve`, { reason: overrideReason })).json(),
    onSuccess: () => {
      toast({ title: "Override applied", description: "Invoice approved and audit trail updated." });
      setOverrideOpen(false); setOverrideReason("");
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "timeline"] });
    },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/invoices/${invoiceId}`, {
      amount: editValues.amount,
      loadNumber: editValues.loadNumber || null,
       debtorId: editValues.debtorId ? Number(editValues.debtorId) : null,
       brokerId: editValues.brokerId ? Number(editValues.brokerId) : null,
      paymentType: editValues.paymentType,
      bankAccountId: editValues.bankAccountId ? Number(editValues.bankAccountId) : null,
    })).json(),
    onSuccess: () => {
      toast({ title: "Invoice updated" }); setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const paymentReferenceMutation = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/invoices/${invoiceId}/payment-reference`, {
      paymentReference: paymentReference.trim(),
    })).json(),
    onSuccess: () => {
      toast({ title: "Payment reference updated" });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "receipts"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "timeline"] });
    },
    onError: (e: any) => toast({ title: "Payment reference update failed", description: e.message, variant: "destructive" }),
  });

  const resendReceiptMutation = useMutation({
    mutationFn: async ({ receiptNo, version }: { receiptNo: string; version: number }) =>
      (await apiRequest("POST", `/api/receipts/${encodeURIComponent(receiptNo)}/resend`, { version })).json(),
    onSuccess: () => toast({ title: "Receipt resent" }),
    onError: (e: any) => toast({ title: "Receipt resend failed", description: e.message, variant: "destructive" }),
  });
  const extendChargebackMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/invoices/${invoiceId}/extend-chargeback`, {
      extensionDate: chargebackExtensionDate, reason: chargebackReason,
    })).json(),
    onSuccess: () => {
      toast({ title: "Chargeback extended" });
      setChargebackDialogOpen(false); setChargebackExtensionDate(""); setChargebackReason("");
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "timeline"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices/chargebacks"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (e: any) => toast({ title: "Unable to extend chargeback", description: e.message, variant: "destructive" }),
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

  const documentTypeMutation = useMutation({
    mutationFn: async ({ documentId, documentType }: { documentId: number; documentType: string }) => {
      const res = await apiRequest("PATCH", `/api/documents/${documentId}/document-type`, { documentType });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Document type updated" });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] });
    },
    onError: () => toast({ title: "Could not update document type", variant: "destructive" }),
  });

  const refreshPaperwork = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] }),
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] }),
      qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] }),
    ]);
  };

  const choosePaperworkFile = (type: string, label: string, existingDocument?: any) => {
    if (existingDocument && !window.confirm(`Upload an additional ${label}? The existing document will be preserved.`)) return;
    document.getElementById(`paperwork-upload-${type}`)?.click();
  };

  const uploadPaperworkFile = async (type: string, label: string, file: File, existingDocument?: any) => {
    setUploadingDocumentType(type);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", type);
      await apiRequest("POST", `/api/invoices/${invoiceId}/documents`, formData);
      await refreshPaperwork();
       toast({ title: existingDocument ? `${label} added as a new document` : `${label} uploaded` });
    } catch (error: any) {
      toast({
        title: `Unable to upload ${label}`,
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingDocumentType(null);
    }
  };

  const transitionMutation = useMutation({
    mutationFn: async ({ transitionId, reason, force, paymentMethod, bankAccountVaultId }: { transitionId: string; reason?: string; force?: boolean; paymentMethod?: "ach" | "wire" | "check"; bankAccountVaultId?: number }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/transition`, { transitionId, reason, force, paymentMethod, bankAccountVaultId });
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
    if (t.id === "fund") {
      setFundBankAccountId("");
      setFundTransition(t);
      return;
    }
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
    <div className="ff-invoice-detail-page flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Load Detail" subtitle="Full factoring lifecycle — documents, status, and funding timeline" group="Workspace" neu />
        <NeuPageShell className="custom-scrollbar min-h-0 flex-1 overflow-auto">
          <PageInsights entity="invoices" entityId={invoiceId} title="Invoice activity" />
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">

            <NeuButton onClick={() => navigate("/invoices")}
              className="mb-5 min-h-9 -ml-2 px-3 text-sm text-[#777]">
              <ArrowLeft className="h-4 w-4" />Back to Invoices
            </NeuButton>

            {preflight?.alerts.filter(alert => alert.code === "DOCS_OCR_FAILED").map(alert => (
              <NeuNotice key={alert.code} severity="info" role="status" data-testid="invoice-ocr-failed" className="mb-4">
                <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4" />
                  {alert.title} <span className="text-xs">{alert.code} · Info</span>
                </p>
                <p className="mt-1 text-sm">{alert.message}</p>
                <Button variant="link" onClick={() => navigate("/documents")}>Open Documents to retry</Button>
              </NeuNotice>
            ))}

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
                 <NeuCard className="overflow-hidden">
                  <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                       <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[3px] bg-[#098b9f] text-white">
                        <ReceiptText className="h-7 w-7" />
                      </div>
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                           <h1 className="text-2xl font-bold tracking-tight text-[#1a1a1a]">Load #{detail.loadNumber || detail.loadId || detail.invoiceNumber}</h1>
                          <InvoiceStatusBadge status={detail.status} />
                        </div>
                         <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#444]">
                           {detail.client && <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-[#098b9f]" />Carrier: <strong>{detail.client.name}</strong></span>}
                            {canonicalBroker && <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-[#098b9f]" />Broker: <strong>{canonicalBroker.name}</strong></span>}
                           <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{fmtDate(detail.submittedAt ?? detail.createdAt)}</span>
                        </div>
                      </div>
                        {(isManager || canAgentCorrect) && <NeuButton className="gap-2 hover:bg-[#27aab8] hover:text-white" onClick={() => {
                        setEditValues({
                          amount: String(detail.amount ?? ""),
                          loadNumber: detail.loadNumber ?? "",
                          debtorId: detail.debtorId ? String(detail.debtorId) : "",
                           brokerId: detail.brokerId ? String(detail.brokerId) : "",
                          paymentType: detail.paymentType ?? "ACH",
                          bankAccountId: detail.bankAccountId ? String(detail.bankAccountId) : "",
                        });
                        setEditOpen(true);
                      }}>
                        <Pencil className="h-4 w-4" />Edit Invoice
                      </NeuButton>}
                    </div>
                     <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invoice Amount</p>
                      <p className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">{fmtCurrency(detail.amount)}</p>
                    </div>
                    </div>
                   <div className="flex items-center gap-2 border-t-2 border-[#808080] bg-[#dff5f6] px-6 py-2.5 text-xs font-semibold text-[#155e63]">
                     <Activity className="h-3.5 w-3.5" />
                     <span>Current workflow</span>
                     <ChevronRight className="h-3.5 w-3.5" />
                     <span className="capitalize">{(detail.displayStatus || detail.status || "in progress").replace(/_/g, " ")}</span>
                     <span className="ml-auto font-normal text-[#5a5a5a]">{STAGE_META[currentStage]?.description}</span>
                   </div>
                   <div className="grid grid-cols-2 gap-3 border-t border-[#c9c9c9] p-4 sm:grid-cols-4">
                    {[
                      { label: "Advance",   value: detail.payout ? fmtCurrency(detail.payout.advanceAmount) : "—", tint: "violet" },
                      { label: "Fee",       value: detail.payout ? fmtCurrency(detail.payout.feeAmount)     : "—", tint: "amber"  },
                      { label: "Reserve",   value: detail.payout ? fmtCurrency(detail.payout.reserveAmount) : "—", tint: "blue"   },
                      { label: "Documents", value: String(detail.documents?.length ?? 0),                           tint: "slate"  },
                    ].map(({ label, value, tint }) => (
                      <NeuStatCard key={label} label={label} value={<span className={cn(
                          tint === "violet" && "text-violet-600 dark:text-violet-400",
                          tint === "amber"  && "text-amber-600 dark:text-amber-400",
                          tint === "blue"   && "text-blue-600 dark:text-blue-400",
                          tint === "slate"  && "text-slate-700 dark:text-slate-300",
                        )}>{value}</span>} className="min-h-24 p-3 text-center [&_p.mt-5]:mt-0 [&_p.text-3xl]:text-xl" />
                    ))}
                  </div>
                </NeuCard>

                 {isManager && <>
                <LifecycleActionsCard
                  invoiceId={invoiceId}
                  transitions={transitions}
                  isLoading={transitionsLoading}
                  userRole={user?.role ?? "employee"}
                  onTransition={openTransitionDialog}
                /></>}

                {/* ── Tabs ──────────────────────────────────────────────── */}
                <NeuCard className="overflow-hidden">
                     <NeuTabs value={activeTab} onValueChange={setActiveTab}>
                    <div className="border-b border-slate-100 px-6 pt-5 dark:border-slate-800">
                        <NeuTabList className="ff-invoice-tabs custom-scrollbar flex h-auto w-full gap-1 overflow-x-auto">
                         {[
                            { value: "overview",   label: "Overview",     icon: <ReceiptText className="h-3.5 w-3.5" /> },
                           { value: "paperwork",  label: "Paperwork",    icon: <FileText className="h-3.5 w-3.5" />,    count: detail.documents?.length, alert: docStatus && !docStatus.canApprove },
                           { value: "broker",     label: "Broker",       icon: <Building2 className="h-3.5 w-3.5" /> },
                           { value: "carrier",    label: "Carrier",      icon: <User className="h-3.5 w-3.5" /> },
                            { value: "collections", label: "Collections", icon: <CreditCard className="h-3.5 w-3.5" />, count: detail.collections?.length },
                            { value: "chargeback",  label: "Chargeback",   icon: <AlertTriangle className="h-3.5 w-3.5" />, alert: ["scheduled", "extended", "charged"].includes(detail.chargeback?.status ?? detail.chargebackStatus) },
                            { value: "cashapp",     label: "Cash Applied", icon: <DollarSign className="h-3.5 w-3.5" />, count: detail.cash?.applications?.length ?? detail.cashAppLines?.length },
                            { value: "sheet",      label: "Payout / Sheet", icon: <Banknote className="h-3.5 w-3.5" /> },
                           { value: "timeline",    label: "Timeline",      icon: <Activity className="h-3.5 w-3.5" /> },
                         ].map(({ value, label, icon, count, alert }: any) => (
                          <NeuTab key={value} value={value}
                             className="flex items-center gap-1.5 px-3 py-2 text-xs">
                            {icon}{label}
                            {!!count && count > 0 && (
                              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>
                            )}
                            {alert && (
                              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                            )}
                          </NeuTab>
                        ))}
                        </NeuTabList>
                    </div>

                     <NeuTabPanel value="broker" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                       <div className="mb-5">
                         <BrokerConfirmationPanel invoiceId={invoiceId} isManager={isManager} />
                       </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <NeuCard className="p-4">
                          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#666]">Broker profile</p>
                          {canonicalBroker ? <div className="space-y-2 text-sm">
                            <p className="text-lg font-bold text-[#1a1a1a]">{canonicalBroker.name}</p>
                            <InfoRow label="Contact" value={canonicalBroker.contactPerson || canonicalBroker.contactName || "Not available"} />
                            <InfoRow label="Email" value={canonicalBroker.email || "Not available"} />
                            <InfoRow label="Phone" value={canonicalBroker.phone || "Not available"} />
                            <InfoRow label="MC #" value={canonicalBroker.mcNumber || "Not available"} />
                            <InfoRow label="DOT #" value={canonicalBroker.dotNumber || "Not available"} />
                            <InfoRow label="Branch" value={detail.branch?.branchName || detail.branchName || "Not available"} />
                            <InfoRow label="Address" value={canonicalBroker.address || "Not available"} />
                            <InfoRow label="Status" value={canonicalBroker.status || "Not available"} />
                            <InfoRow label="Credit limit" value={canonicalBroker.creditLimit ? fmtCurrency(canonicalBroker.creditLimit) : "Not available"} />
                          </div> : <EmptyTabState icon={<Building2 className="h-7 w-7" />} label="No broker details available" />}
                        </NeuCard>
                         <NeuCard className="p-4">
                           <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#666]">Broker history</p>
                           <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                             <div><p className="text-lg font-bold">{fmtCurrency(detail.brokerHistory?.totals?.billed)}</p><p className="text-[10px] text-[#666]">Billed</p></div>
                             <div><p className="text-lg font-bold text-teal-700">{fmtCurrency(detail.brokerHistory?.totals?.applied)}</p><p className="text-[10px] text-[#666]">Applied</p></div>
                             <div><p className="text-lg font-bold text-amber-700">{fmtCurrency(detail.brokerHistory?.totals?.outstanding)}</p><p className="text-[10px] text-[#666]">Outstanding</p></div>
                           </div>
                           {detail.brokerHistory?.invoices?.length ? (
                             <NeuTable className="text-xs">
                               <NeuTableHeader><NeuTableRow><NeuTableHead>Invoice</NeuTableHead><NeuTableHead>Date / status</NeuTableHead><NeuTableHead className="text-right">Amount / balance</NeuTableHead></NeuTableRow></NeuTableHeader>
                               <NeuTableBody>{detail.brokerHistory.invoices.map((row: any) => <NeuTableRow key={row.id}><NeuTableCell className="font-semibold">{row.invoiceNumber}</NeuTableCell><NeuTableCell className="text-xs text-[#777]">{fmtDate(row.invoiceDate)} · {row.status}</NeuTableCell><NeuTableCell className="text-right">{fmtCurrency(row.amount)} · Bal. {fmtCurrency(row.balance)}</NeuTableCell></NeuTableRow>)}</NeuTableBody>
                             </NeuTable>
                           ) : <EmptyTabState icon={<CreditCard className="h-7 w-7" />} label="No broker history available" />}
                           <div className="mt-3 border-t border-[#d4d0c8] pt-3 text-xs"><InfoRow label="Current AR" value={fmtCurrency(detail.brokerHistory?.credit?.currentAr)} /><InfoRow label="Latest credit check" value={detail.brokerHistory?.credit?.latestCheck ? `${fmtDate(detail.brokerHistory.credit.latestCheck.createdAt)} · ${detail.brokerHistory.credit.latestCheck.status || detail.brokerHistory.credit.latestCheck.result || "Recorded"}` : "Not available"} /></div>
                         </NeuCard>
                      </div>
                    </NeuTabPanel>

                    <NeuTabPanel value="carrier" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                      <div className="grid gap-4 md:grid-cols-2">
                        <NeuCard className="p-4">
                          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#666]">Carrier profile</p>
                          {detail.client ? <div className="space-y-2 text-sm">
                            <p className="text-lg font-bold text-[#1a1a1a]">{detail.client.name}</p>
                            <InfoRow label="Contact" value={detail.client.contactPerson || detail.client.contactName || "Not available"} />
                            <InfoRow label="Email" value={detail.client.email || "Not available"} />
                            <InfoRow label="Phone" value={detail.client.phone || "Not available"} />
                            <InfoRow label="MC #" value={detail.client.mcNumber || "Not available"} />
                            <InfoRow label="DOT #" value={detail.client.dotNumber || "Not available"} />
                            <InfoRow label="Address" value={[detail.client.address, detail.client.city, detail.client.state, detail.client.zipCode].filter(Boolean).join(", ") || "Not available"} />
                            <InfoRow label="Status" value={detail.client.status || "Not available"} />
                            <InfoRow label="Assigned processor" value={detail.assignedProcessorUser ? `${detail.assignedProcessorUser.firstName} ${detail.assignedProcessorUser.lastName}` : "Not assigned"} />
                          </div> : <EmptyTabState icon={<User className="h-7 w-7" />} label="No carrier details available" />}
                        </NeuCard>
                        <NeuCard className="p-4">
                          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#666]">Bank account</p>
                           {detail.carrierInvoices?.bankAccounts?.length ? detail.carrierInvoices.bankAccounts.map((a: any) => <NeuCard key={a.id} className="mb-2 px-3 py-2 text-sm"><p className="font-semibold">{a.bankName || "Bank account"}</p><p className="text-xs text-[#666]">{a.accountType || "Account"} ending in {a.lastFour || "••••"}</p></NeuCard>) : <p className="text-sm text-[#666]">No bank account on file.</p>}
                          <p className="mt-3 text-[11px] text-[#666]">Full bank credentials are restricted to authorized funding workflows.</p>
                        </NeuCard>
                         <NeuCard className="p-4 md:col-span-2">
                           <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#666]">Other carrier invoices</p>
                           <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                             {(detail.carrierInvoices?.invoices ?? []).filter((row: any) => !row.isCurrent).map((row: any) => (
                                <NeuButton key={row.id} type="button" onClick={() => navigate(`/invoices/${row.id}`)} className="flex min-h-10 w-full items-center justify-between px-3 py-2 text-left text-xs">
                                 <span><strong>{row.invoiceNumber}</strong><br /><span className="text-[#666]">{fmtDate(row.invoiceDate)} · {row.status}</span></span><span className="font-semibold">{fmtCurrency(row.amount)}</span>
                                </NeuButton>
                             ))}
                           </div>
                           {!detail.carrierInvoices?.invoices?.some((row: any) => !row.isCurrent) && <p className="text-sm text-[#666]">No other carrier invoices.</p>}
                         </NeuCard>
                      </div>
                    </NeuTabPanel>

                    {/* Doc Checklist */}
                    {false && (
                        docStatusLoading ? (
                        <div className="space-y-3">
                          {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
                        </div>
                      ) : !docStatus ? (
                        <p className="text-sm text-slate-400">No checklist data available.</p>
                      ) : (
                        <div className="space-y-5">
                          {/* Overall progress bar */}
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            {docStatus.overrideApplied ? (
                              <Badge className="gap-1.5 border border-violet-200 bg-violet-50 text-violet-700">
                                <ShieldCheck className="h-3.5 w-3.5" />Override Applied
                              </Badge>
                            ) : <span />}
                            {isAdmin && !docStatus.overrideApplied && detail.status === "under_review" && (
                              <Button variant="outline" className="gap-2 border-violet-300 text-violet-700" onClick={() => setOverrideOpen(true)}>
                                <ShieldCheck className="h-4 w-4" />Override & Approve
                              </Button>
                            )}
                          </div>
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
                                <NeuNotice severity="ack" className="flex items-start gap-3">
                                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                  <div>
                                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Missing for Review</p>
                                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                                      {docStatus.missingForReview.join(", ")}
                                    </p>
                                  </div>
                                </NeuNotice>
                              )}
                              {docStatus.missingForApproval?.length > 0 && (
                                <NeuNotice severity="block" className="flex items-start gap-3">
                                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                                  <div>
                                    <p className="text-xs font-semibold text-red-800 dark:text-red-300">Missing for Approval</p>
                                    <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
                                      {docStatus.missingForApproval.join(", ")}
                                    </p>
                                  </div>
                                </NeuNotice>
                              )}
                            </div>
                          )}

                          {/* All-clear banner */}
                          {docStatus.canApprove && (
                            <NeuNotice severity="info" className="flex items-center gap-3">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                                All required documents are present. This invoice can proceed to approval.
                              </p>
                            </NeuNotice>
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
                                      rule.confirmed
                                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                                        : rule.present
                                          ? "bg-blue-100 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
                                          : rule.required
                                            ? "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                                            : "bg-slate-100 text-slate-400 dark:bg-slate-800"
                                    )}>
                                      {rule.confirmed
                                        ? <CheckCircle2 className="h-4 w-4" />
                                        : rule.present
                                          ? <FileCheck className="h-4 w-4" />
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
                                        {/* Review status badge */}
                                        {rule.reviewStatus && (
                                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                                            rule.reviewStatus === "confirmed"
                                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                              : rule.reviewStatus === "rejected"
                                                ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                                                : rule.reviewStatus === "unreadable"
                                                  ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                                                  : "bg-slate-100 text-slate-500"
                                          )}>
                                            {rule.reviewStatus === "confirmed" ? "✓ Agent Confirmed" : `Agent: ${rule.reviewStatus}`}
                                          </span>
                                        )}
                                      </div>
                                      {rule.description && (
                                        <p className="mt-0.5 text-[11px] text-slate-400">{rule.description}</p>
                                      )}
                                      {rule.document?.originalName && (
                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                          {rule.document.originalName}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {rule.document?.id && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className={cn(
                                            "h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-medium",
                                            rule.confirmed
                                              ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
                                              : "border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300"
                                          )}
                                          onClick={() => setReviewDocId(rule.document.id)}
                                        >
                                          <ClipboardCheck className="h-3 w-3" />
                                          {rule.confirmed ? "Re-review" : "Review"}
                                        </Button>
                                      )}
                                      <span className={cn("text-xs font-semibold",
                                        rule.confirmed ? "text-emerald-600 dark:text-emerald-400"
                                        : rule.present ? "text-blue-600 dark:text-blue-400"
                                        : "text-red-500 dark:text-red-400"
                                      )}>
                                        {rule.confirmed ? "Confirmed" : rule.present ? "Uploaded" : "Missing"}
                                      </span>
                                    </div>
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
                                    <SelectTrigger className="ff-invoice-select-trigger rounded-xl border-slate-200 text-xs dark:border-slate-700">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="ff-invoice-neu-select-content">
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
                       )
                     )}

                    <NeuTabPanel value="chargeback" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                         <div className="space-y-5">
                           <NeuCard className="flex flex-wrap items-center justify-between gap-3 p-5">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Chargeback Schedule</p>
                               <Badge className={cn("mt-2 capitalize", detail.chargeback.status === "charged" ? "bg-red-600" : detail.chargeback.status === "extended" ? "bg-emerald-600" : "bg-amber-600")}>{detail.chargeback.status}</Badge>
                               <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">Chargeback date: <strong>{fmtDate(detail.chargeback.chargebackDate)}</strong></p>
                            </div>
                             {isManager && ["scheduled", "extended"].includes(detail.chargeback.status) && <Button onClick={() => setChargebackDialogOpen(true)} disabled={detail.chargeback.status === "charged"}>Extend Chargeback</Button>}
                           </NeuCard>
                            {detail.chargeback.extension && <NeuCard className="p-4 text-sm">
                            <p className="font-semibold">Latest Extension</p>
                             <p className="mt-1 text-slate-500">Extended {fmtDate(detail.chargeback.extension.at)} to {fmtDate(detail.chargeback.extension.date)}</p>
                             <p className="mt-2">{detail.chargeback.extension.reason}</p>
                           </NeuCard>}
                          <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Extension History</h3>
                             {detail.chargeback.history?.length ? (
                               <div className="space-y-2">{detail.chargeback.history.map((event: any) => {
                                 const actorName = event.actor?.name
                                   || [event.actor?.firstName, event.actor?.lastName].filter(Boolean).join(" ")
                                   || event.actorUser?.name
                                   || [event.actorUser?.firstName, event.actorUser?.lastName].filter(Boolean).join(" ")
                                   || event.metadata?.agentName
                                   || event.actorId
                                   || "System";
                                  return <NeuCard key={event.id} className="p-3 text-sm"><p className="font-semibold capitalize">{event.eventType.replace(/_/g, " ")}</p><p className="mt-1">{event.reason || "No reason recorded"}</p><p className="text-xs text-slate-400">{actorName} · {fmtDate(event.createdAt)}{event.extensionDate ? ` · through ${fmtDate(event.extensionDate)}` : ""}</p></NeuCard>;
                               })}</div>
                            ) : <p className="text-sm text-slate-400">No extension history.</p>}
                          </div>
                            <ChargebackLifecycle key={detail.id} invoiceId={Number(detail.id)} />
                         </div>
                    </NeuTabPanel>

                    {/* Overview */}
                     <NeuTabPanel value="overview" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <div className="space-y-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Invoice Details</h3>
                          {[
                            { label: "Invoice #",    value: detail.invoiceNumber },
                             { label: "Status",        value: <InvoiceStatusBadge status={detail.status} /> },
                             { label: "Submitted",     value: fmtDate(detail.submittedAt ?? detail.createdAt) },
                            { label: "Load #",       value: detail.loadNumber || (detail.loadId ? `#${detail.loadId}` : "—") },
                            { label: "Code",         value: detail.code || "—" },
                             { label: "Branch",       value: detail.branch?.branchName || detail.branchName || "—" },
                            { label: "Buyout",       value: detail.buyout == null ? "—" : detail.buyout ? "Yes" : "No" },
                            { label: "Lumper",       value: detail.lumper == null ? "—" : detail.lumper ? "Yes" : "No" },
                            { label: "Amount",       value: fmtCurrency(detail.amount) },
                            { label: "Invoice Date", value: fmtDate(detail.invoiceDate) },
                            { label: "Due Date",     value: fmtDate(detail.dueDate) },
                            { label: "BOL Number",   value: detail.bolNumber || "—" },
                            { label: "Payment Type", value: detail.paymentType || "—" },
                             { label: "Selected Bank", value: detail.selectedBankAccount ? `${detail.selectedBankAccount.bankName} — ending in ${detail.selectedBankAccount.lastFour}` : "—" },
                            { label: "Load Type",    value: <LoadTypeBadge value={detail.loadType} neuStyle /> },
                            { label: "Driver",       value: detail.driver ? `${detail.driver.firstName} ${detail.driver.lastName}` : "—" },
                            { label: "Pickup",       value: detail.pickupLocation || "—" },
                            { label: "Delivery",     value: detail.deliveryLocation || "—" },
                            { label: "Instructions Subject", value: detail.instructionsSubject || "—" },
                            { label: "Instructions Details", value: detail.instructionsDetails
                              ? <span className="whitespace-pre-wrap break-words">{detail.instructionsDetails}</span>
                              : "—" },
                          ].map(({ label, value }) => (
                            <NeuCard key={label} className="flex items-start justify-between gap-3 px-4 py-2.5">
                              <span className="text-xs font-medium text-slate-400">{label}</span>
                              <span className="text-right text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</span>
                            </NeuCard>
                          ))}
                        </div>
                        <div className="space-y-5">
                          {detail.client && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Carrier / Client</h3>
                              <NeuCard className="p-4">
                                <div className="mb-1 flex items-center gap-2">
                                  <User className="h-4 w-4 text-blue-500" />
                                  <span className="font-semibold text-slate-800 dark:text-white">{detail.client.name}</span>
                                </div>
                                <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {detail.client.email && <p>{detail.client.email}</p>}
                                  {detail.client.phone && <p>{detail.client.phone}</p>}
                                   {detail.client.mcNumber && <p>MC# {detail.client.mcNumber}</p>}
                                   {detail.client.dotNumber && <p>DOT# {detail.client.dotNumber}</p>}
                                   {detail.assignedProcessorUser && <p>Processor: {detail.assignedProcessorUser.firstName} {detail.assignedProcessorUser.lastName}</p>}
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => navigate(`/clients/${detail.client.id}`)}
                                  className="mt-2 h-7 gap-1 rounded-lg px-2 text-[11px] text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/20">
                                  <ExternalLink className="h-3 w-3" />View Client
                                </Button>
                              </NeuCard>
                            </div>
                          )}
                           {canonicalBroker && (
                            <div>
                              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Debtor / Broker</h3>
                              <NeuCard className="p-4">
                                <div className="mb-1 flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-violet-500" />
                                   <span className="font-semibold text-slate-800 dark:text-white">{canonicalBroker.name}</span>
                                </div>
                                <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                   {canonicalBroker.email && <p>{canonicalBroker.email}</p>}
                                   {canonicalBroker.phone && <p>{canonicalBroker.phone}</p>}
                                   {canonicalBroker.mcNumber && <p>MC# {canonicalBroker.mcNumber}</p>}
                                   {canonicalBroker.dotNumber && <p>DOT# {canonicalBroker.dotNumber}</p>}
                                   {(detail.branch?.branchName || detail.branchName) && <p>Branch: {detail.branch?.branchName || detail.branchName}</p>}
                                </div>
                              </NeuCard>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-6" id="invoice-notes-anchor">
                        <EntityNotes key={`invoice:${invoiceId}`} entityType="invoice" entityId={invoiceId} focusNoteId={focusNoteId}
                          onFocused={() => setFocusNoteId(null)} />
                      </div>
                    </NeuTabPanel>

                    {/* Documents */}
                    <NeuTabPanel value="paperwork" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                          {[
                            { type: "bill_of_lading", label: "BOL", aliases: ["bill_of_lading", "bol"] },
                            { type: "rate_confirmation", label: "Rate Con", aliases: ["rate_confirmation"] },
                            { type: "lumper_receipt", label: "Lumper", aliases: ["lumper_receipt", "receipt"] },
                            { type: "invoice", label: "Invoice", aliases: ["invoice", "commercial_invoice"] },
                            { type: "noa", label: "NOA", aliases: ["noa"] },
                            { type: "release_letter", label: "Release Letter", aliases: ["release_letter"] },
                            { type: "other", label: "Other", aliases: ["other"] },
                          ].map(({ type, label, aliases }) => {
                            const rule = docStatus?.rules?.find((r: any) => aliases.includes(r.documentType));
                            const doc = detail.documents?.find((d: any) =>
                              aliases.includes(documentClassification(d))
                            );
                            const present = !!rule?.present || !!doc;
                            const uploading = uploadingDocumentType === type;
                            return (
                              <div key={type}>
                                <input
                                  id={`paperwork-upload-${type}`}
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) uploadPaperworkFile(type, label, file, doc);
                                  }}
                                />
                                <NeuCard
                                  role="button"
                                  tabIndex={0}
                                   onClick={() => doc
                                     ? setPreviewDocument(doc)
                                    : choosePaperworkFile(type, label)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                       doc
                                         ? setPreviewDocument(doc)
                                        : choosePaperworkFile(type, label);
                                    }
                                  }}
                                  className="group min-h-[132px] cursor-pointer p-3 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", present ? "bg-emerald-100" : "bg-red-100")}>
                                      {uploading
                                        ? <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                                        : <FileText className={cn("h-5 w-5", present ? "text-emerald-700" : "text-red-700")} />}
                                    </div>
                                    {present && doc && !uploading && (
                                      <div className="flex items-center gap-1">
                                         <NeuButton type="button" title={`View ${label}`} className="h-8 min-h-8 w-8 p-1.5 text-emerald-700 hover:bg-emerald-100"
                                           onClick={(event) => { event.stopPropagation(); window.open(`/api/documents/${doc.id}/view`, "_blank", "noopener,noreferrer"); }}
                                         >
                                          <Eye className="h-4 w-4" />
                                        </NeuButton>
                                        <a title={`Download ${label}`} href={`/api/documents/${doc.id}/download`}
                                          onClick={(event) => event.stopPropagation()}
                                          className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-100">
                                          <Download className="h-4 w-4" />
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                  <p className="mt-2 truncate text-xs font-bold text-slate-900">{label}</p>
                                  <p className={cn("text-[11px] font-semibold", present ? "text-emerald-700" : "text-red-700")}>
                                    {uploading ? "Uploading..." : present ? "Uploaded" : "Missing"}
                                  </p>
                                  {doc && <p className="mt-1 truncate text-[10px] text-slate-500" title={doc.originalName}>{doc.originalName}</p>}
                                  {present && doc && !uploading && (
                                    <NeuButton type="button" className="mt-2 min-h-7 gap-1 bg-transparent px-1 py-0 text-[10px] text-emerald-700 shadow-none hover:underline"
                                      onClick={(event) => { event.stopPropagation(); choosePaperworkFile(type, label, doc); }}
                                      >
                                       <Upload className="h-3 w-3" />Add newer copy
                                    </NeuButton>
                                  )}
                                </NeuCard>
                              </div>
                            );
                          })}
                        </div>
                        {docStatus && <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[3px] border-2 px-3 py-2 text-xs", docStatus.canApprove ? "border-[#6aa36a] bg-[#e8f5e8] text-[#166534]" : "border-[#c99a42] bg-[#fff8df] text-[#7a5100]")}>
                          <span className="font-bold">Document readiness: {docStatus.completenessPercent ?? 0}%</span>
                          {!docStatus.canApprove && <span>Missing: {[...(docStatus.missingForReview ?? []), ...(docStatus.missingForApproval ?? [])].join(", ") || "Review required"}</span>}
                          {isAdmin && !docStatus.overrideApplied && detail.status === "under_review" && <Button size="sm" variant="outline" className="h-7 rounded-[2px] text-[11px]" onClick={() => setOverrideOpen(true)}><ShieldCheck className="mr-1 h-3 w-3" />Override & Approve</Button>}
                        </div>}
                         {previewDocument && (
                           <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-700">
                             <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2 text-xs text-slate-200">
                               <span className="truncate">{previewDocument.originalName}</span>
                                <div className="flex items-center gap-2">
                                  <a href={`/api/documents/${previewDocument.id}/download`} className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-2 py-1 hover:bg-slate-600"><Download className="h-3 w-3" />Download</a>
                                 <NeuButton type="button" onClick={() => setPreviewDocument(null)} className="min-h-7 px-2 py-1 text-xs">Close</NeuButton>
                                </div>
                              </div>
                             {String(previewDocument.mimeType || "").startsWith("image/") ? <img src={`/api/documents/${previewDocument.id}/view`} alt={previewDocument.originalName} className="mx-auto max-h-[520px] max-w-full object-contain" /> : <iframe title={`Preview ${previewDocument.originalName}`} src={`/api/documents/${previewDocument.id}/view`} className="h-[520px] w-full bg-white" />}
                           </div>
                         )}
                        {/* Drag-and-drop intake zone */}
                        <div>
                          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Upload Documents
                          </h3>
                          <DocumentIntakeZone
                            entityType="invoice"
                            entityId={invoiceId}
                            neuStyle
                            onUploadComplete={() => {
                              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
                              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
                              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] });
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
                                <NeuCard key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                                  <div className="flex items-center gap-3">
                                     <FileText className="h-5 w-5 shrink-0 text-red-500" />
                                    <div>
                                      <p className="text-sm font-medium text-slate-800 dark:text-white">{doc.originalName}</p>
                                       <p className="text-xs text-slate-400">{documentClassificationLabel(documentClassification(doc))} · {(doc.size / 1024).toFixed(1)} KB · {fmtDate(doc.createdAt)}</p>
                                       <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
                                       <p className="text-[11px] text-slate-500">{doc.uploadedByUser ? `${doc.uploadedByUser.firstName || ""} ${doc.uploadedByUser.lastName || ""}`.trim() || doc.uploadedByUser.email : "Uploader unavailable"}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      <Button data-testid={`invoice-document-view-${doc.id}`} variant="outline" size="sm" className="h-8 rounded-lg px-2 text-[11px]" onClick={() => window.open(`/api/documents/${doc.id}/view`, "_blank", "noopener,noreferrer")}><Eye className="mr-1 h-3 w-3" />View</Button>
                                      <a href={`/api/documents/${doc.id}/download`} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px]"><Download className="h-3 w-3" />Download</a>
                                    <Select
                                      value={documentClassification(doc)}
                                      onValueChange={(documentType) =>
                                        documentTypeMutation.mutate({ documentId: doc.id, documentType })
                                      }
                                      disabled={documentTypeMutation.isPending}
                                    >
                                      <SelectTrigger className="ff-invoice-select-trigger h-8 w-[190px] rounded-lg bg-white text-xs dark:bg-slate-950">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="ff-invoice-neu-select-content">
                                        <SelectItem value="rate_confirmation">Rate Confirmation</SelectItem>
                                        <SelectItem value="bill_of_lading">Bill of Lading (BOL)</SelectItem>
                                        <SelectItem value="lumper_receipt">Lumper Receipt</SelectItem>
                                        <SelectItem value="commercial_invoice">Commercial Invoice</SelectItem>
                                        <SelectItem value="freight_invoice">Freight Invoice</SelectItem>
                                        <SelectItem value="invoice">Invoice</SelectItem>
                                        <SelectItem value="bol">Bill of Lading</SelectItem>
                                        <SelectItem value="proof_of_delivery">Proof of Delivery</SelectItem>
                                        <SelectItem value="pod">Proof of Delivery (POD)</SelectItem>
                                        <SelectItem value="noa">Notice of Assignment (NOA)</SelectItem>
                                        <SelectItem value="release_letter">Release Letter</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px]",
                                      doc.status === "processed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                                      {doc.status}
                                    </Badge>
                                  </div>
                                </NeuCard>
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
                    </NeuTabPanel>

                    {/* Payout */}
                    <NeuTabPanel value="sheet" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
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
                              { label: "Payment Method", value: String(detail.payout.paymentMethod ?? "ach").toUpperCase(), tint: "slate" },
                            ].map(({ label, value, tint }) => (
                              <NeuCard key={label} className="p-4">
                                <p className="mb-1 text-xs text-slate-400">{label}</p>
                                <p className={cn("text-lg font-semibold",
                                  tint === "emerald" && "text-emerald-600 dark:text-emerald-400",
                                  tint === "violet"  && "text-violet-600 dark:text-violet-400",
                                  tint === "blue"    && "text-blue-600 dark:text-blue-400",
                                  tint === "amber"   && "text-amber-600 dark:text-amber-400",
                                  tint === "teal"    && "text-teal-600 dark:text-teal-400",
                                  tint === "slate"   && "text-slate-700 dark:text-slate-200",
                                )}>{value}</p>
                              </NeuCard>
                            ))}
                          </div>
                          <NeuCard className="flex items-center justify-between px-4 py-3">
                            <span className="text-sm text-slate-500">Payout Status</span>
                            <Badge className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                              {detail.payout.paymentStatus?.replace(/_/g, " ")}
                            </Badge>
                          </NeuCard>
                           {detail.payoutDetail?.funding && <NeuNotice severity={detail.payoutDetail.funding.paymentSent ? "info" : "ack"} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" />Payment sent: <strong>{detail.payoutDetail.funding.paymentSent ? "Yes" : "No"}</strong></NeuNotice>}
                           {detail.payoutDetail?.funding && <NeuCard className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Funding details</p><div className="mt-2 grid gap-2 text-sm sm:grid-cols-3"><div><span className="text-xs text-violet-600">Funding status</span><p className="font-semibold capitalize">{String(detail.payoutDetail.funding.status || "pending").replace(/_/g, " ")}</p></div><div><span className="text-xs text-violet-600">Funded date</span><p className="font-semibold">{fmtDate(detail.payoutDetail.funding.fundedDate)}</p></div><div><span className="text-xs text-violet-600">Funded by</span><p className="font-semibold">{detail.payoutDetail.funding.fundedBy ? `${detail.payoutDetail.funding.fundedBy.firstName || ""} ${detail.payoutDetail.funding.fundedBy.lastName || ""}`.trim() : "—"}</p></div></div></NeuCard>}
                            <NeuCard className="p-4">
                             <div className="flex items-center justify-between gap-3">
                               <div>
                                 <p className="text-sm font-semibold text-slate-800 dark:text-white">Funding receipts</p>
                                 <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Immutable receipt versions issued when this invoice is funded.</p>
                               </div>
                               <ReceiptText className="h-5 w-5 text-violet-500" />
                             </div>
                             {receiptsLoading ? (
                               <div className="mt-4 space-y-2">
                                 <Skeleton className="h-10 w-full rounded-lg" />
                                 <Skeleton className="h-10 w-full rounded-lg" />
                               </div>
                             ) : receipts.length === 0 ? (
                               <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                                 No funding receipt has been issued yet.
                               </p>
                             ) : (
                               <div className="mt-4 space-y-2">
                                 {receipts.map((receipt) => (
                                    <NeuCard key={`${receipt.receiptNo}-${receipt.version}`} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                                     <div className="min-w-0 flex-1">
                                       <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                                         {receipt.receiptNo} · Version {receipt.version}
                                       </p>
                                       <p className="text-xs text-slate-500 dark:text-slate-400">
                                         {receipt.createdAt || receipt.fundedAt ? new Date(receipt.createdAt || receipt.fundedAt || "").toLocaleDateString() : "Date unavailable"}
                                         {" · "}{receipt.paymentReference || "Payment reference pending"}
                                       </p>
                                      </div>
                                     <a
                                       href={`/api/receipts/${encodeURIComponent(receipt.receiptNo)}/download?version=${receipt.version}`}
                                       target="_blank"
                                       rel="noreferrer"
                                       className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                     >
                                       <Download className="h-3.5 w-3.5" />Download
                                     </a>
                                     {isManager && (
                                       <Button
                                         type="button"
                                         size="sm"
                                         variant="outline"
                                         className="rounded-xl text-xs"
                                         disabled={resendReceiptMutation.isPending}
                                         onClick={() => resendReceiptMutation.mutate({ receiptNo: receipt.receiptNo, version: receipt.version })}
                                       >
                                         Resend
                                       </Button>
                                     )}
                                    </NeuCard>
                                 ))}
                               </div>
                             )}
                             {isManager && (
                               <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                                 <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Payment reference</label>
                                 <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                                   <Input
                                     value={paymentReference}
                                     onChange={(e) => setPaymentReference(e.target.value)}
                                     placeholder="ACH, wire, or check reference"
                                     className="h-9 rounded-xl text-sm"
                                   />
                                   <Button
                                     type="button"
                                     size="sm"
                                     className="h-9 rounded-xl text-xs"
                                    disabled={paymentReferenceMutation.isPending || !paymentReference.trim() || paymentReference.trim() === String(detail?.paymentReference ?? "").trim()}
                                     onClick={() => paymentReferenceMutation.mutate()}
                                   >
                                     {paymentReferenceMutation.isPending ? "Saving..." : "Save reference"}
                                   </Button>
                                 </div>
                               </div>
                             )}
                            </NeuCard>
                          {detail.payout.notes && (
                             <NeuCard className="p-4 text-sm">{detail.payout.notes}</NeuCard>
                          )}
                          {/* Document readiness for payment */}
                          {docStatus && (
                             <NeuNotice severity={docStatus.canApprove ? "info" : "ack"} className="flex items-center gap-3">
                              {docStatus.canApprove
                                ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                                : <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />}
                              <div className="text-xs">
                                <span className={cn("font-semibold",
                                  docStatus.canApprove ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"
                                )}>
                                  {docStatus.canApprove
                                    ? "All required documents confirmed — payment eligible"
                                    : `Document readiness: ${docStatus.completenessPercent ?? 0}% — ${(docStatus.missingForApproval ?? []).join(", ") || "review required"}`
                                  }
                                </span>
                              </div>
                            </NeuNotice>
                          )}
                          <Button variant="outline" size="sm" onClick={() => navigate("/payouts")} className="gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Manage in Payouts
                          </Button>
                        </div>
                      )}
                    </NeuTabPanel>

                    {/* Collections */}
                    <NeuTabPanel value="collections" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                       <div className="space-y-5">
                         {detail.collections?.length ? (
                         <div className="space-y-2">
                          {detail.collections.map((c: any) => (
                            <NeuCard key={c.id} className="p-4">
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
                            </NeuCard>
                          ))}
                         </div>
                         ) : <EmptyTabState icon={<CreditCard className="h-7 w-7" />} label="No collection records linked to this invoice" />}
                         {!!detail.collectionsDetail?.brokerFollowUps?.length && (
                            <NeuCard className="p-4">
                             <h3 className="mb-3 text-sm font-semibold">Broker follow-ups</h3>
                             <div className="space-y-3">
                               {detail.collectionsDetail.brokerFollowUps.map((followUp: any) => (
                                 <div key={followUp.id} className="border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
                                   <div className="flex justify-between gap-3"><strong>{followUp.subject || "Broker follow-up"}</strong><span className="text-slate-400">{fmtDate(followUp.sentAt || followUp.createdAt)}</span></div>
                                   <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{followUp.body || followUp.message || "No message body recorded."}</p>
                                   <p className="mt-1 text-slate-400">Status: {followUp.status || "Recorded"} · Delivery: {followUp.deliveryStatus || "Not reported"}</p>
                                   {!!(followUp.reminders || followUp.deliveryInstances || followUp.instances)?.length && (
                                     <div className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                                       {(followUp.reminders || followUp.deliveryInstances || followUp.instances).map((instance: any, instanceIndex: number) => (
                                         <div key={instance.id ?? instanceIndex} className="text-[11px] text-slate-500 dark:text-slate-400">
                                           <div className="flex flex-wrap gap-x-2">
                                              <span>{instance.actualSendAt || instance.sentAt || instance.actualSentAt ? `Sent ${new Date(instance.actualSendAt || instance.sentAt || instance.actualSentAt).toLocaleString()}` : instance.scheduledSendAt || instance.scheduledAt || instance.scheduledFor ? `Scheduled ${new Date(instance.scheduledSendAt || instance.scheduledAt || instance.scheduledFor).toLocaleString()}` : "Time not recorded"}</span>
                                             <span>· {instance.subject || followUp.subject || "Reminder"}</span>
                                             <span>· {instance.status || "Recorded"}</span>
                                             <span>· {instance.deliveryStatus || "Delivery not reported"}</span>
                                           </div>
                                           {(instance.body || instance.message) && <p className="mt-0.5 whitespace-pre-wrap">{instance.body || instance.message}</p>}
                                         </div>
                                       ))}
                                     </div>
                                   )}
                                 </div>
                                ))}
                              </div>
                            </NeuCard>
                         )}
                           <NeuCard className="flex flex-col gap-2 p-4">
                             <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-[#168c98]" /><h3 className="text-sm font-semibold">Team invoice notes</h3></div>
                             <p className="text-xs text-slate-500">Notes are shared across the invoice workspace and managed in Overview.</p>
                             <NeuButton className="w-fit" onClick={() => { setFocusNoteId(-1); setActiveTab("overview"); }}>
                               Open invoice notes
                             </NeuButton>
                           </NeuCard>
                       </div>
                     </NeuTabPanel>

                    {/* Cash Application */}
                    <NeuTabPanel value="cashapp" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                       <div className="mb-4 grid grid-cols-3 gap-3">
                          <NeuCard className="p-3"><p className="text-xs text-slate-400">Invoice amount</p><p className="text-lg font-semibold">{fmtCurrency(detail.amount)}</p></NeuCard>
                          <NeuCard className="p-3"><p className="text-xs text-emerald-700">Applied</p><p className="text-lg font-semibold text-emerald-700">{fmtCurrency(detail.cash?.appliedTotal)}</p></NeuCard>
                          <NeuCard className="p-3"><p className="text-xs text-amber-700">Running balance</p><p className="text-lg font-semibold text-amber-700">{fmtCurrency(detail.cash?.outstanding)}</p></NeuCard>
                       </div>
                       {(detail.cash?.applications?.length ?? detail.cashAppLines?.length ?? 0) === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16">
                          <EmptyTabState icon={<DollarSign className="h-7 w-7" />} label="No payments applied to this invoice yet" />
                          <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")} className="mt-2 gap-1.5 rounded-xl text-xs">
                            <ExternalLink className="h-3.5 w-3.5" />Go to Cash Application
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                           {(detail.cash?.applications ?? detail.cashAppLines).map((l: any) => (
                             <NeuCard key={l.id} className="p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800 dark:text-white">Applied: {fmtCurrency(l.appliedAmount)}</p>
                                   <p className="text-xs text-slate-400">Invoice total: {fmtCurrency(l.invoiceAmount)}{l.application?.paymentDate ? ` · Paid ${fmtDate(l.application.paymentDate)}` : ""}</p>
                                   {l.application && <p className="text-xs text-slate-500">{fmtCurrency(l.application.totalReceived)} received · {l.application.paymentMethod || "Method unavailable"} · {l.application.paymentReference || "No reference"} · {l.application.payorName || "Payor unavailable"}</p>}
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
                            </NeuCard>
                          ))}
                          <div className="pt-2">
                            <Button variant="outline" size="sm" onClick={() => navigate("/cash-application")} className="gap-1.5 rounded-xl text-xs">
                              <ExternalLink className="h-3.5 w-3.5" />Manage in Cash Application
                            </Button>
                          </div>
                           {detail.cash?.shortPay && <NeuCard className="p-3 text-xs text-amber-800">Short-pay: <strong>{fmtCurrency(detail.cash.shortPay.amount)}</strong>{detail.cash.shortPay.reason ? ` · ${detail.cash.shortPay.reason}` : ""}</NeuCard>}
                        </div>
                      )}
                    </NeuTabPanel>

                    {/* Exceptions */}
                     {false && (
                       !detail.exceptions?.length ? (
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
                       )
                     )}

                    {/* Timeline */}
                    <NeuTabPanel value="timeline" unmountInactive className="mt-0 rounded-none bg-transparent p-6 shadow-none">
                      {timelineLoading ? (
                        <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
                       ) : !(timeline?.length || detail.timeline?.length) ? (
                        <EmptyTabState icon={<Activity className="h-7 w-7" />} label="No activity recorded yet" />
                      ) : (
                        <div className="relative space-y-0">
                          <div className="absolute left-[26px] top-4 bottom-4 w-px bg-slate-100 dark:bg-slate-800" />
                            {(timeline?.length ? timeline : detail.timeline).map((event: any) => (
                            <div key={event.id} className="relative flex gap-4 pb-5">
                              <div className="relative z-10 mt-0.5 shrink-0"><TimelineIcon category={event.category} /></div>
                              <NeuCard className="flex-1 px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                   <p className="text-sm font-semibold text-slate-800 dark:text-white">{event.title}</p>
                                  <time className="shrink-0 text-[11px] text-slate-400">
                                     {event.timestamp ? new Date(event.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                                  </time>
                                </div>
                                {event.description && !((event.metadata ?? event.meta)?.noteId != null || (event.metadata ?? event.meta)?.noteAction) && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{event.description}</p>}
                                  {(event.actor?.name || event.actor?.firstName || event.actorUser?.name || event.actorUser?.firstName || event.actorName || event.actorId || event.meta?.actorType === "system") && <p className="mt-1 text-[11px] text-slate-400">By {event.actor?.name || [event.actor?.firstName, event.actor?.lastName].filter(Boolean).join(" ") || event.actorUser?.name || [event.actorUser?.firstName, event.actorUser?.lastName].filter(Boolean).join(" ") || event.actorName || event.actorId || "System"}</p>}
                                   {((event.metadata ?? event.meta)?.noteId != null || (event.metadata ?? event.meta)?.noteAction) && (
                                     <NeuButton className="mt-2 min-h-8 px-2.5 py-1 text-[11px] text-[#168c98]"
                                       onClick={() => {
                                         const metadata = event.metadata ?? event.meta ?? {};
                                         const isDeleted = String(metadata.noteAction ?? "").toLowerCase().includes("delet");
                                         setFocusNoteId(isDeleted ? -1 : Number(metadata.noteId));
                                         setActiveTab("overview");
                                       }}>
                                       {String((event.metadata ?? event.meta)?.noteAction ?? "").toLowerCase().includes("delet") ? "Open notes" : "View note"}
                                     </NeuButton>
                                   )}
                              </NeuCard>
                            </div>
                          ))}
                        </div>
                      )}
                    </NeuTabPanel>
                  </NeuTabs>
                </NeuCard>

              </div>
            )}
          </div>
        </NeuPageShell>
      </div>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="ff-invoice-neu-dialog">
          <DialogHeader>
            <DialogTitle>Override & Approve</DialogTitle>
            <DialogDescription>Override document requirements and approve this invoice? This will be logged.</DialogDescription>
          </DialogHeader>
          <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Required override reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button onClick={() => overrideMutation.mutate()} disabled={!overrideReason.trim() || overrideMutation.isPending}>Confirm Override & Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fundTransition} onOpenChange={(open) => { if (!open) setFundTransition(null); }}>
        <DialogContent className="ff-invoice-neu-dialog">
          <DialogHeader>
            <DialogTitle>Fund Invoice</DialogTitle>
            <DialogDescription>
              Confirm the carrier advance using their configured rates.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
            <div><span className="text-slate-500">Gross invoice</span><p className="font-semibold">{fmtCurrency(detail?.amount)}</p></div>
            <div><span className="text-slate-500">Advance rate</span><p className="font-semibold">{detail?.client?.advanceRate ?? "80.00"}%</p></div>
            <div><span className="text-slate-500">Advance amount</span><p className="font-semibold">{fmtCurrency(Number(detail?.amount ?? 0) * Number(detail?.client?.advanceRate ?? 80) / 100)}</p></div>
            <div><span className="text-slate-500">Factoring fee</span><p className="font-semibold">{detail?.client?.factoringFeeRate ?? "3.00"}%</p></div>
            <div><span className="text-slate-500">Reserve held</span><p className="font-semibold">{fmtCurrency(Number(detail?.amount ?? 0) * (100 - Number(detail?.client?.advanceRate ?? 80)) / 100)}</p></div>
            <div><span className="text-slate-500">Net to carrier</span><p className="font-semibold">{fmtCurrency(Number(detail?.amount ?? 0) * (Number(detail?.client?.advanceRate ?? 80) - Number(detail?.client?.factoringFeeRate ?? 3)) / 100)}</p></div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Payment Method</label>
            <Select value={fundMethod} onValueChange={(v: "ach" | "wire" | "check") => setFundMethod(v)}>
              <SelectTrigger className="ff-invoice-select-trigger"><SelectValue /></SelectTrigger>
              <SelectContent className="ff-invoice-neu-select-content"><SelectItem value="ach">ACH</SelectItem><SelectItem value="wire">Wire</SelectItem><SelectItem value="check">Check</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Bank Account</label>
            {bankAccountsLoading ? (
              <p className="text-sm text-slate-500">Loading bank accounts…</p>
            ) : carrierBankAccounts.length ? (
              <Select value={fundBankAccountId} onValueChange={setFundBankAccountId}>
                <SelectTrigger className="ff-invoice-select-trigger"><SelectValue placeholder="Select destination account" /></SelectTrigger>
                <SelectContent className="ff-invoice-neu-select-content">
                  {carrierBankAccounts.map((account: any) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      Account ending in {account.lastFour} — {account.bankName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <NeuNotice severity="ack" className="text-sm">
                No bank accounts on file for this carrier — <a className="font-semibold underline" href={`/vault?clientId=${carrierId}`}>add one in Vault</a>
              </NeuNotice>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFundTransition(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!fundTransition) return;
              transitionMutation.mutate({ transitionId: fundTransition.id, paymentMethod: fundMethod, bankAccountVaultId: Number(fundBankAccountId) });
              setFundTransition(null);
            }} disabled={transitionMutation.isPending || !fundBankAccountId || bankAccountsLoading}>Confirm Funding</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="ff-invoice-neu-dialog">
          <DialogHeader><DialogTitle>Edit Invoice</DialogTitle><DialogDescription>Update invoice billing and load details.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">Amount</label><Input type="number" value={editValues.amount} onChange={e => setEditValues(v => ({ ...v, amount: e.target.value }))} /></div>
            <div><label className="text-sm font-medium">Load Number</label><Input value={editValues.loadNumber} onChange={e => setEditValues(v => ({ ...v, loadNumber: e.target.value }))} /></div>
            <div><label className="text-sm font-medium">Broker</label><Select value={editValues.brokerId || "none"} onValueChange={v => setEditValues(s => ({ ...s, brokerId: v === "none" ? "" : v, debtorId: "" }))}><SelectTrigger className="ff-invoice-select-trigger"><SelectValue placeholder="Select broker" /></SelectTrigger><SelectContent className="ff-invoice-neu-select-content"><SelectItem value="none">No broker</SelectItem>{brokers.map((broker: any) => <SelectItem key={broker.id} value={String(broker.id)}>{broker.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Payment Type</label><Select value={editValues.paymentType} onValueChange={v => setEditValues(s => ({ ...s, paymentType: v }))}><SelectTrigger className="ff-invoice-select-trigger"><SelectValue /></SelectTrigger><SelectContent className="ff-invoice-neu-select-content"><SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent></Select></div>
            {["ACH", "Wire"].includes(editValues.paymentType) && <div>
              <label className="text-sm font-medium">Bank Account</label>
              {carrierBankAccounts.length ? (
                <Select value={editValues.bankAccountId} onValueChange={bankAccountId => setEditValues(s => ({ ...s, bankAccountId }))}>
                  <SelectTrigger className="ff-invoice-select-trigger"><SelectValue placeholder="Select bank account" /></SelectTrigger>
                  <SelectContent className="ff-invoice-neu-select-content">{carrierBankAccounts.map((account: any) => <SelectItem key={account.id} value={String(account.id)}>{account.bankName} — {account.accountType ? account.accountType.charAt(0).toUpperCase() + account.accountType.slice(1) : "Account"} ending in {account.lastFour}</SelectItem>)}</SelectContent>
                </Select>
              ) : <NeuNotice severity="ack" className="mt-1 text-sm">No bank accounts on file — <a className="font-semibold underline" href={`/vault?clientId=${carrierId}`}>add in carrier Vault</a></NeuNotice>}
            </div>}
          </div>
          {editOpen && <EntityNotes key={`edit-invoice:${invoiceId}`} entityType="invoice" entityId={invoiceId} />}
          <DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={() => editMutation.mutate()} disabled={!editValues.amount || editMutation.isPending || (["ACH", "Wire"].includes(editValues.paymentType) && !editValues.bankAccountId)}>Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={chargebackDialogOpen} onOpenChange={setChargebackDialogOpen}>
        <DialogContent className="ff-invoice-neu-dialog">
          <DialogHeader><DialogTitle>Extend Chargeback</DialogTitle><DialogDescription>Choose a new future chargeback date and provide the reason for the extension.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm font-medium">New Chargeback Date</label><Input type="date" min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} value={chargebackExtensionDate} onChange={e => setChargebackExtensionDate(e.target.value)} /></div>
            <div><label className="text-sm font-medium">Reason</label><Textarea value={chargebackReason} onChange={e => setChargebackReason(e.target.value)} placeholder="Explain why the chargeback should be extended" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setChargebackDialogOpen(false)}>Cancel</Button><Button onClick={() => extendChargebackMutation.mutate()} disabled={!chargebackExtensionDate || chargebackReason.trim().length < 3 || extendChargebackMutation.isPending}>Confirm Extension</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transition dialog */}
      <TransitionDialog
        transition={selectedTransition}
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setSelectedTransition(null); }}
        onConfirm={confirmTransition}
        isPending={transitionMutation.isPending}
        isAdmin={isAdmin}
      />

      {/* Document review dialog */}
      {reviewDocId !== null && (
        <DocumentReviewDialog
          documentId={reviewDocId}
          open={reviewDocId !== null}
          neuStyle
          onOpenChange={(open) => { if (!open) setReviewDocId(null); }}
          onReviewComplete={() => {
            qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
            qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "available-transitions"] });
          }}
        />
      )}
    </div>
  );
}

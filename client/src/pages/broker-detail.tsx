import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import RecordDetail, {
  DetailRow, DetailSection, EmptyTab,
} from "@/components/layout/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  Building2, ReceiptText, Phone, Mail, MapPin, ShieldCheck,
  CreditCard, DollarSign, Clock, FileText, Edit2, Ban,
  CheckCircle2, AlertTriangle, User, Hash, TrendingUp, Plus, Trash2,
  MessageSquare, Send,
  RefreshCw, Award,
} from "lucide-react";
import { ProcessorAssignment } from "@/components/assignments/processor-assignment";
import BrokerEditDialog from "@/components/brokers/broker-edit-dialog";
import DumpStatementTimeline from "@/components/brokers/dump-statement-timeline";
import type { Broker } from "@shared/schema";

// ─── Status badge ─────────────────────────────────────────────────────────────

function BrokerStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    inactive:  "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    suspended: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  };
  return (
    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold shadow-sm", colors[status] ?? colors.inactive)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// ─── Invoice status badge ─────────────────────────────────────────────────────

function InvBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    funded:       "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
    submitted:    "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
    under_review: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    docs_pending: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
    rejected:     "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300",
    settled:      "bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300",
    draft:        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", colors[status] ?? colors.draft)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const TERMS_LABEL: Record<string, string> = {
  quickpay: "Quick Pay", net15: "Net 15", net30: "Net 30",
  net45: "Net 45", net60: "Net 60",
};

const fmt = (v: string | number | null | undefined) =>
  v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function creditGradeClass(grade?: string | null) {
  return grade === "A" ? "border-emerald-200 bg-emerald-100 text-emerald-700" :
    grade === "B" ? "border-teal-200 bg-teal-100 text-teal-700" :
    grade === "C" ? "border-yellow-200 bg-yellow-100 text-yellow-700" :
    grade === "D" ? "border-orange-200 bg-orange-100 text-orange-700" :
    grade === "F" ? "border-red-200 bg-red-100 text-red-700" :
    "border-slate-200 bg-slate-100 text-slate-500";
}

function CreditScorePanel({ brokerId, canRecalculate }: { brokerId: number; canRecalculate: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ current: any | null; history: any[] }>({
    queryKey: ["/api/brokers", brokerId, "credit"],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${brokerId}/credit`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load credit report");
      return response.json();
    },
    enabled: Number.isFinite(brokerId),
  });
  const calculateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/brokers/${brokerId}/calculate-credit`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Failed to recalculate credit");
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "credit"] });
      qc.invalidateQueries({ queryKey: ["/api/brokers"] });
      toast({ title: "Credit score recalculated" });
    },
    onError: (error: Error) => toast({ title: "Unable to recalculate credit", description: error.message, variant: "destructive" }),
  });
  const report = data?.current;
  const history = data?.history ?? [];
  const score = Math.max(0, Math.min(100, Number(report?.score ?? report?.creditScore ?? 0)));
  const breakdown = [
    ["Payment Speed", Number(report?.paymentSpeedScore ?? report?.breakdown?.paymentSpeed ?? 0), 40],
    ["Payment Reliability", Number(report?.paymentReliabilityScore ?? report?.breakdown?.paymentReliability ?? 0), 30],
    ["Chargeback Rate", Number(report?.chargebackScore ?? report?.breakdown?.chargebackRate ?? 0), 20],
    ["Short Pay / Disputes", Number(report?.shortPayScore ?? report?.breakdown?.shortPayDisputes ?? 0), 10],
  ];
  const grade = report?.grade ?? report?.creditGrade ?? null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-2"><Award className="h-4 w-4 text-violet-600" /><h3 className="text-xs font-semibold text-slate-700 dark:text-white">Broker Creditworthiness</h3></div>
        {canRecalculate && <Button size="sm" variant="outline" className="h-7 gap-1 rounded-lg px-2 text-[10px]" disabled={calculateMutation.isPending} onClick={() => calculateMutation.mutate()}><RefreshCw className={cn("h-3 w-3", calculateMutation.isPending && "animate-spin")} />Recalculate</Button>}
      </div>
      <div className="space-y-4 p-5">
        {isLoading ? <div className="py-6 text-center text-xs text-slate-400">Loading credit report…</div> : !report ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">No credit score calculated yet.</div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#27aab8 ${score * 3.6}deg, #e2e8f0 0deg)` }}>
                <div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-white dark:bg-slate-900"><span className="text-2xl font-black text-slate-900 dark:text-white">{score}</span><span className="text-[9px] uppercase tracking-wide text-slate-400">/ 100</span></div>
              </div>
              <div><span className={`inline-flex rounded-full border px-3 py-1 text-lg font-black ${creditGradeClass(grade)}`}>{grade ?? "—"}</span><p className="mt-1 text-xs text-slate-500">{grade === "F" ? "Critical — do not factor" : grade === "D" ? "Poor — frequent delays or issues" : grade === "A" ? "Excellent — pay fast, no issues" : "Broker payment performance"}</p></div>
            </div>
            <div className="space-y-2.5">{breakdown.map(([label, value, max]) => <div key={String(label)}><div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500"><span>{label}</span><span>{value} / {max}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-[#27aab8]" style={{ width: `${Math.min(100, Number(value) / Number(max) * 100)}%` }} /></div></div>)}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[["Avg Days to Pay", report.avgDaysToPayment ?? "—"], ["Total Invoices", report.totalInvoices ?? 0], ["Chargebacks", report.totalChargebacks ?? 0], ["Short Pays", report.totalShortPays ?? 0]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-900/50"><p className="text-slate-400">{label}</p><p className="mt-0.5 font-bold text-slate-700 dark:text-slate-200">{value}</p></div>)}
            </div>
            {history.length > 0 && <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Credit history · last 12 months</p><div className="flex h-16 items-end gap-1">{history.slice(-12).map((item: any, index: number) => <div key={`${item.id ?? item.lastCalculatedAt ?? index}`} title={`${item.grade ?? "—"} · ${item.score ?? 0}`} className="flex-1 rounded-t bg-[#27aab8]" style={{ height: `${Math.max(8, Number(item.score ?? 0))}%` }} />)}</div></div>}
            <p className="text-[10px] text-slate-400">Last calculated: {fmtDate(report.lastCalculatedAt)}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BrokerDetail() {
  const { id } = useParams<{ id: string }>();
  const brokerId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusDialog, setStatusDialog] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [newStatus, setNewStatus] = useState<"active" | "inactive" | "suspended">("inactive");
  const [noteText, setNoteText] = useState("");
  const [branchDialog, setBranchDialog] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [branchForm, setBranchForm] = useState({
    branchName: "", address: "", city: "", state: "", zip: "",
    phone: "", email: "", contactName: "", status: "active" as "active" | "inactive",
  });

  const { data: broker, isLoading, refetch: refetchBroker } = useQuery<any>({
    queryKey: ["/api/brokers", brokerId],
    queryFn: async () => {
      const r = await fetch(`/api/brokers/${brokerId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !isNaN(brokerId),
  });

  const { data: allInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices", { all: true }],
    enabled: !isNaN(brokerId),
  });

  const { data: branches = [], isLoading: branchesLoading, isError: branchesError } = useQuery<any[]>({
    queryKey: ["/api/brokers", brokerId, "branches"],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${brokerId}/branches`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load branches");
      return response.json();
    },
    enabled: !isNaN(brokerId),
  });

  const brokerInvoices = allInvoices.filter(
    (inv: any) => inv.brokerId != null ? inv.brokerId === brokerId : inv.debtorId === brokerId
  );

  const totalVolume = brokerInvoices.reduce((s: number, inv: any) => s + parseFloat(inv.amount ?? "0"), 0);
  const openCount   = brokerInvoices.filter((inv: any) => !["settled", "rejected"].includes(inv.status)).length;

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}`, { status }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId] });
      qc.invalidateQueries({ queryKey: ["/api/brokers"] });
      setStatusDialog(false);
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}`, { notes }),
    onSuccess: () => {
      toast({ title: "Notes saved" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId] });
      setNoteText("");
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const openEditBroker = async () => {
    setLoadingEdit(true);
    try {
      const result = await refetchBroker({ throwOnError: true });
      if (!result.data || result.data.id !== brokerId) throw new Error("Broker information is unavailable.");
      setEditingBroker(result.data);
    } catch (error) {
      toast({ title: "Unable to open broker editor", description: error instanceof Error ? error.message : "Failed to load broker.", variant: "destructive" });
    } finally {
      setLoadingEdit(false);
    }
  };

  const branchPayload = () => ({
    branchName: branchForm.branchName.trim(),
    address: branchForm.address.trim() || null,
    city: branchForm.city.trim() || null,
    state: branchForm.state.trim() || null,
    zip: branchForm.zip.trim() || null,
    phone: branchForm.phone.trim() || null,
    email: branchForm.email.trim() || null,
    contactName: branchForm.contactName.trim() || null,
    status: branchForm.status,
  });
  const branchMutation = useMutation({
    mutationFn: async () => apiRequest(
      editingBranchId ? "PATCH" : "POST",
      editingBranchId ? `/api/brokers/${brokerId}/branches/${editingBranchId}` : `/api/brokers/${brokerId}/branches`,
      branchPayload(),
    ),
    onSuccess: () => {
      toast({ title: editingBranchId ? "Branch updated" : "Branch added" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
      setBranchDialog(false);
    },
    onError: (error: Error) => toast({ title: "Failed to save branch", description: error.message, variant: "destructive" }),
  });
  const deleteBranchMutation = useMutation({
    mutationFn: (branchId: number) => apiRequest("DELETE", `/api/brokers/${brokerId}/branches/${branchId}`),
    onSuccess: () => {
      toast({ title: "Branch removed" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
    },
    onError: (error: Error) => toast({ title: "Failed to remove branch", description: error.message, variant: "destructive" }),
  });
  const toggleBranchMutation = useMutation({
    mutationFn: ({ branchId, status }: { branchId: number; status: "active" | "inactive" }) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}/branches/${branchId}`, { status }),
    onSuccess: () => {
      toast({ title: "Branch status updated" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
    },
    onError: (error: Error) => toast({ title: "Failed to update branch status", description: error.message, variant: "destructive" }),
  });
  const openBranchDialog = (branch?: any) => {
    setEditingBranchId(branch?.id ?? null);
    setBranchForm({
      branchName: branch?.branchName ?? "", address: branch?.address ?? "",
      city: branch?.city ?? "", state: branch?.state ?? "", zip: branch?.zip ?? "",
      phone: branch?.phone ?? "", email: branch?.email ?? "",
      contactName: branch?.contactName ?? "", status: branch?.status ?? "active",
    });
    setBranchDialog(true);
  };

  const creditUtilPct = broker?.creditLimit && totalVolume
    ? Math.min(100, Math.round((totalVolume / broker.creditLimit) * 100))
    : 0;

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.05),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Broker Detail"
          subtitle="Debtor profile, credit terms, and linked invoices"
          group="Workspace"
        />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">
            <RecordDetail
              backHref="/brokers"
              backLabel="Back to Brokers"
              isLoading={isLoading}
              notFound={!isLoading && !broker}
              notFoundIcon={<Building2 className="h-8 w-8" />}
              notFoundLabel="Broker not found"
              icon={<Building2 className="h-7 w-7" />}
              iconBg="bg-violet-600 text-white shadow-[0_8px_20px_rgba(124,58,237,0.28)]"
              title={broker?.name ?? ""}
              titleSub={[
                broker?.city && broker?.state ? `${broker.city}, ${broker.state}` : null,
                broker?.mcNumber ? `MC# ${broker.mcNumber}` : null,
                broker?.dotNumber ? `DOT# ${broker.dotNumber}` : null,
              ].filter(Boolean).join(" · ")}
              statusBadge={broker ? <BrokerStatusBadge status={broker.status} /> : undefined}
              metrics={[
                { label: "Credit Limit", value: fmt(broker?.creditLimit), tint: "violet" },
                { label: "Total Volume", value: fmt(totalVolume), tint: "blue" },
                { label: "Open Invoices", value: String(openCount), tint: "amber" },
                { label: "All Invoices", value: String(brokerInvoices.length), tint: "slate" },
                { label: "Payment Terms", value: TERMS_LABEL[broker?.paymentTerms] ?? broker?.paymentTerms ?? "—", tint: "slate" },
              ]}
              alertBanner={creditUtilPct >= 90 ? (
                <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 dark:border-red-900/40 dark:bg-red-950/20">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    Credit utilisation at {creditUtilPct}% — approaching or exceeding credit limit
                  </p>
                </div>
              ) : undefined}
              linkedRecords={[
                { label: "MC Number",   icon: <Hash className="h-4 w-4" />,      value: broker?.mcNumber || "—",     tint: "violet" },
                { label: "DOT Number",  icon: <ShieldCheck className="h-4 w-4" />, value: broker?.dotNumber || "—",    tint: "blue" },
                { label: "Contact",     icon: <User className="h-4 w-4" />,       value: broker?.contactPerson || "—", tint: "slate" },
                { label: "Email",       icon: <Mail className="h-4 w-4" />,       value: broker?.email || "—",         tint: "slate" },
                { label: "Phone",       icon: <Phone className="h-4 w-4" />,      value: broker?.phone || "—",         tint: "slate" },
              ]}
              actions={
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 rounded-2xl border-slate-200 text-xs dark:border-slate-700"
                    data-testid="broker-profile-edit"
                    disabled={loadingEdit || !broker}
                    onClick={openEditBroker}
                  >
                    <Edit2 className="h-3.5 w-3.5" />{loadingEdit ? "Loading…" : "Edit Broker"}
                  </Button>
                   <div className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                     <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assigned Processor</p>
                     <ProcessorAssignment record={broker} endpoint={`/api/brokers/${brokerId}/assign`} queryKey={["/api/brokers", brokerId]} />
                   </div>
                  {isAdmin && broker && broker.status !== "active" && (
                    <Button size="sm" onClick={() => statusMutation.mutate("active")}
                      disabled={statusMutation.isPending}
                      className="w-full justify-start gap-2 rounded-2xl bg-emerald-600 text-xs text-white hover:bg-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />Activate Broker
                    </Button>
                  )}
                  {isAdmin && broker && broker.status === "active" && (
                    <Button size="sm" variant="outline"
                      onClick={() => { setNewStatus("suspended"); setStatusDialog(true); }}
                      className="w-full justify-start gap-2 rounded-2xl border-red-200 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400">
                      <Ban className="h-3.5 w-3.5" />Suspend Broker
                    </Button>
                  )}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400 mb-2">Credit limit utilisation</p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={cn("h-full rounded-full transition-all", creditUtilPct >= 90 ? "bg-red-500" : creditUtilPct >= 70 ? "bg-amber-500" : "bg-emerald-500")}
                        style={{ width: `${creditUtilPct}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">{creditUtilPct}% of {fmt(broker?.creditLimit)}</p>
                  </div>
                </div>
              }
              rightExtra={
                <>
                <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <h3 className="text-xs font-semibold text-slate-700 dark:text-white">Payment Risk</h3>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-50 px-5 dark:divide-slate-800/60">
                    {[
                      { label: "Open Invoices", value: String(openCount), tint: openCount > 5 ? "red" : "slate" },
                      { label: "Total Exposure", value: fmt(totalVolume), tint: totalVolume > (broker?.creditLimit ?? 0) ? "red" : "emerald" },
                      { label: "Credit Limit", value: fmt(broker?.creditLimit), tint: "slate" },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between py-3">
                        <span className="text-xs text-slate-500">{r.label}</span>
                        <span className={cn("text-xs font-semibold",
                          r.tint === "red" ? "text-red-600 dark:text-red-400" :
                          r.tint === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
                          "text-slate-700 dark:text-slate-300"
                        )}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <CreditScorePanel brokerId={brokerId} canRecalculate={isAdmin} />
                </>
              }
              tabs={[
                {
                  value: "overview",
                  label: "Overview",
                  icon: <Building2 className="h-3.5 w-3.5" />,
                  content: (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <DetailSection title="Contact Details">
                        <DetailRow label="Contact Person" value={broker?.contactPerson} />
                        <DetailRow label="Email" value={broker?.email} />
                        <DetailRow label="Phone" value={broker?.phone} />
                      </DetailSection>
                      <DetailSection title="Location">
                        <DetailRow label="Address" value={broker?.address} />
                        <DetailRow label="City" value={broker?.city} />
                        <DetailRow label="State" value={broker?.state} />
                        <DetailRow label="ZIP" value={broker?.zipCode} />
                      </DetailSection>
                      <DetailSection title="Credentials">
                        <DetailRow label="MC Number" value={broker?.mcNumber} />
                        <DetailRow label="DOT Number" value={broker?.dotNumber} />
                        <DetailRow label="Payment Terms" value={TERMS_LABEL[broker?.paymentTerms] ?? broker?.paymentTerms} />
                        <DetailRow label="Credit Limit" value={fmt(broker?.creditLimit)} />
                      </DetailSection>
                      <DetailSection title="Record">
                        <DetailRow label="Status" value={broker?.status} />
                        <DetailRow label="Created" value={fmtDate(broker?.createdAt)} />
                        <DetailRow label="Updated" value={fmtDate(broker?.updatedAt)} />
                      </DetailSection>
                    </div>
                  ),
                },
                {
                  value: "invoices",
                  label: "Invoices",
                  icon: <ReceiptText className="h-3.5 w-3.5" />,
                  count: brokerInvoices.length,
                  content: !brokerInvoices.length ? (
                    <EmptyTab icon={<ReceiptText className="h-7 w-7" />} label="No invoices linked to this broker" />
                  ) : (
                    <div className="space-y-2">
                      {brokerInvoices.map((inv: any) => (
                        <a key={inv.id} href={`/invoices/${inv.id}`}
                          className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 transition-colors hover:border-blue-200 hover:bg-blue-50/30 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-blue-900/40">
                          <div className="flex items-center gap-3">
                            <ReceiptText className="h-4 w-4 shrink-0 text-blue-500" />
                            <div>
                              <p className="text-sm font-semibold text-slate-800 dark:text-white">{inv.invoiceNumber}</p>
                              <p className="text-xs text-slate-400">{fmtDate(inv.invoiceDate ?? inv.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmt(inv.amount)}</span>
                            <InvBadge status={inv.status} />
                          </div>
                        </a>
                      ))}
                    </div>
                  ),
                },
                {
                  value: "branches",
                  label: "Branches",
                  icon: <MapPin className="h-3.5 w-3.5" />,
                  count: branches.length,
                  content: (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800 dark:text-white">Broker Branches</h3>
                          <p className="text-xs text-slate-500">Manage branch contacts and operating locations.</p>
                        </div>
                        {isAdmin && (
                          <Button size="sm" onClick={() => openBranchDialog()} className="gap-2 rounded-xl bg-violet-600 text-xs text-white hover:bg-violet-700">
                            <Plus className="h-3.5 w-3.5" /> Add Branch
                          </Button>
                        )}
                      </div>
                      {branchesLoading ? (
                        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Loading branches...</div>
                      ) : branchesError ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load branches. Please try again.</div>
                      ) : !branches.length ? (
                        <EmptyTab icon={<MapPin className="h-7 w-7" />} label="No branches on file" />
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                          <div className="min-w-[760px]">
                            <div className="grid grid-cols-[1.3fr_1fr_0.7fr_1fr_1fr_0.7fr_auto] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60">
                              <span>Branch Name</span><span>City</span><span>State</span><span>Phone</span><span>Contact</span><span>Status</span><span />
                            </div>
                            {branches.map((branch: any) => (
                              <div key={branch.id} className="grid grid-cols-[1.3fr_1fr_0.7fr_1fr_1fr_0.7fr_auto] items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                                <span className="font-semibold text-slate-800 dark:text-white">{branch.branchName}</span>
                                <span className="text-slate-600 dark:text-slate-300">{branch.city || "—"}</span>
                                <span className="text-slate-600 dark:text-slate-300">{branch.state || "—"}</span>
                                <span className="text-slate-600 dark:text-slate-300">{branch.phone || "—"}</span>
                                <span className="text-slate-600 dark:text-slate-300">{branch.contactName || "—"}</span>
                                <Badge className={cn("w-fit capitalize", branch.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{branch.status}</Badge>
                                {isAdmin ? (
                                  <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openBranchDialog(branch)}><Edit2 className="h-3.5 w-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-[11px]" disabled={toggleBranchMutation.isPending} onClick={() => toggleBranchMutation.mutate({ branchId: branch.id, status: branch.status === "active" ? "inactive" : "active" })}>{branch.status === "active" ? "Deactivate" : "Activate"}</Button>
                                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-red-600" disabled={deleteBranchMutation.isPending} onClick={() => { if (window.confirm(`Remove ${branch.branchName}?`)) deleteBranchMutation.mutate(branch.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </div>
                                ) : <span />}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  value: "notes",
                  label: "Notes",
                  icon: <MessageSquare className="h-3.5 w-3.5" />,
                  content: (
                    <div className="space-y-4">
                      {broker?.notes && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Current Notes</p>
                          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{broker.notes}</p>
                        </div>
                      )}
                      {isAdmin && (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {broker?.notes ? "Update Notes" : "Add Notes"}
                          </p>
                          <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="Add internal notes about this broker..."
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          />
                          <Button size="sm"
                            disabled={notesMutation.isPending || !noteText.trim()}
                            onClick={() => notesMutation.mutate(noteText)}
                            className="gap-2 rounded-xl bg-violet-600 text-xs text-white hover:bg-violet-700">
                            <Send className="h-3.5 w-3.5" />
                            {notesMutation.isPending ? "Saving..." : "Save Notes"}
                          </Button>
                        </div>
                      )}
                      {!broker?.notes && !isAdmin && (
                        <EmptyTab icon={<MessageSquare className="h-7 w-7" />} label="No notes for this broker" />
                      )}
                    </div>
                  ),
                },
                {
                  value: "timeline",
                  label: "Timeline",
                  icon: <Clock className="h-3.5 w-3.5" />,
                  content: <DumpStatementTimeline brokerId={brokerId} />,
                },
              ]}
            />
          </div>
        </main>
      </div>

      {/* Status change confirm dialog */}
      {editingBroker?.id === brokerId && (
        <BrokerEditDialog broker={editingBroker} onClose={() => setEditingBroker(null)} />
      )}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="max-w-sm rounded-3xl border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              Suspend Broker
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Suspending this broker will flag all linked invoices. Are you sure?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setStatusDialog(false)}>Cancel</Button>
            <Button size="sm" className="rounded-xl bg-red-600 text-xs text-white hover:bg-red-700"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(newStatus)}>
              {statusMutation.isPending ? "Suspending..." : "Confirm Suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={branchDialog} onOpenChange={setBranchDialog}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle>{editingBranchId ? "Edit Branch" : "Add Branch"}</DialogTitle>
            <DialogDescription>Store the branch contact and location used for broker invoices.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (branchForm.branchName.trim()) branchMutation.mutate(); }}>
            {([
              ["branchName", "Branch Name", true], ["address", "Address", false],
              ["city", "City", false], ["state", "State", false], ["zip", "ZIP", false],
              ["phone", "Phone", false], ["email", "Email", false], ["contactName", "Contact Name", false],
            ] as const).map(([key, label, required]) => (
              <div key={key} className={key === "address" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <label className="text-sm font-medium">{label}{required && <span className="text-red-500"> *</span>}</label>
                <Input required={required} type={key === "email" ? "email" : "text"} value={branchForm[key]} onChange={event => setBranchForm(form => ({ ...form, [key]: event.target.value }))} />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Status</label>
              <Select value={branchForm.status} onValueChange={status => setBranchForm(form => ({ ...form, status: status as "active" | "inactive" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setBranchDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={branchMutation.isPending || !branchForm.branchName.trim()} className="bg-violet-600 text-white hover:bg-violet-700">
                {branchMutation.isPending ? "Saving..." : editingBranchId ? "Save Changes" : "Add Branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

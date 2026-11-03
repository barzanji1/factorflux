import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRiskToast as useToast } from "@/components/risk/risk-controls";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskCard as Card, RiskButton as Button, RiskInput as Input, RiskDialogContent as DialogContent, RiskSelectContent as SelectContent, RiskSelectTrigger as SelectTrigger, RiskStatCard, RiskBadge, RiskTable } from "@/components/risk/risk-controls";
import { NeuPageShell } from "@/styles/neu/components";
import "@/components/risk/risk-neu.css";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Shield,
  Plus,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Building2,
  Truck,
} from "lucide-react";

type CreditCheck = {
  id: number;
  entityType: "broker" | "debtor";
  entityId: number;
  entityName: string;
  mcNumber?: string | null;
  dotNumber?: string | null;
  riskScore?: number | null;
  riskTier?: "low" | "medium" | "high" | "critical" | null;
  creditLimit?: string | null;
  recommendedCreditLimit?: string | null;
  avgDaysToPay?: number | null;
  status: "pending" | "approved" | "approved_with_conditions" | "declined" | "expired";
  expiresAt?: string | null;
  checkedBy?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Debtor = { id: number; name: string; mcNumber?: string | null; dotNumber?: string | null; creditLimit?: string | null; avgDaysToPay?: number | null; };
type Broker = { id: number; name: string; mcNumber?: string | null; dotNumber?: string | null; creditLimit?: number | null; };

const RISK_CONFIG = {
  low: { label: "Low Risk", icon: ShieldCheck, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/50", badge: "ff-badge-funded" },
  medium: { label: "Medium Risk", icon: Shield, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/50", badge: "ff-badge-pending" },
  high: { label: "High Risk", icon: ShieldAlert, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-900/50", badge: "ff-badge-overdue" },
  critical: { label: "Critical Risk", icon: ShieldX, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/50", badge: "ff-badge-rejected" },
};

const STATUS_CONFIG = {
  pending: { label: "Pending", icon: Clock, color: "ff-badge-pending" },
  approved: { label: "Approved", icon: CheckCircle2, color: "ff-badge-funded" },
  approved_with_conditions: { label: "Conditional", icon: AlertTriangle, color: "ff-badge-partial" },
  declined: { label: "Declined", icon: XCircle, color: "ff-badge-rejected" },
  expired: { label: "Expired", icon: RefreshCw, color: "ff-badge-draft" },
};

function scoreBar(score: number | null | undefined) {
  if (!score) return null;
  const pct = Math.min(100, Math.max(0, score));
  const color = score >= 70 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : score >= 30 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="ff-review-rating-track h-3 flex-1">
        <div className={cn("h-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums w-6 text-right">{score}</span>
    </div>
  );
}

export default function CreditChecks() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "broker" | "debtor">("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({
    entityType: "debtor" as "broker" | "debtor",
    entityId: "",
    riskScore: "",
    riskTier: "medium" as "low" | "medium" | "high" | "critical",
    creditLimit: "",
    recommendedCreditLimit: "",
    avgDaysToPay: "",
    status: "pending" as CreditCheck["status"],
    notes: "",
  });

  const { data: checks = [], isLoading } = useQuery<CreditCheck[]>({ queryKey: ["/api/credit-checks"] });
  const { data: debtors = [] } = useQuery<Debtor[]>({ queryKey: ["/api/debtors"] });
  const { data: brokers = [] } = useQuery<Broker[]>({ queryKey: ["/api/brokers", { all: true }] });

  const createMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/credit-checks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credit-checks"] });
      setShowDialog(false);
      toast({ title: "Credit check created", description: "New assessment has been recorded." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: number; [k: string]: unknown }) => {
      const { id, ...data } = payload;
      return apiRequest("PATCH", `/api/credit-checks/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credit-checks"] });
      toast({ title: "Status updated" });
    },
  });

  const entityOptions = form.entityType === "debtor" ? debtors : brokers;

  const filtered = checks.filter(c => {
    if (filterType !== "all" && c.entityType !== filterType) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (search && !c.entityName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: checks.length,
    approved: checks.filter(c => c.status === "approved" || c.status === "approved_with_conditions").length,
    pending: checks.filter(c => c.status === "pending").length,
    declined: checks.filter(c => c.status === "declined").length,
    highRisk: checks.filter(c => c.riskTier === "high" || c.riskTier === "critical").length,
  };

  function handleSubmit() {
    if (!form.entityId) { toast({ title: "Select an entity", variant: "destructive" }); return; }
    const entity = entityOptions.find(e => e.id === Number(form.entityId));
    createMutation.mutate({
      entityType: form.entityType,
      entityId: Number(form.entityId),
      entityName: entity?.name || "",
      mcNumber: entity?.mcNumber || null,
      dotNumber: entity?.dotNumber || null,
      riskScore: form.riskScore ? Number(form.riskScore) : null,
      riskTier: form.riskTier,
      creditLimit: form.creditLimit || null,
      recommendedCreditLimit: form.recommendedCreditLimit || null,
      avgDaysToPay: form.avgDaysToPay ? Number(form.avgDaysToPay) : null,
      status: form.status,
      notes: form.notes || null,
    });
  }

  return (
    <div className="risk-neu-page ff-credit-checks-page flex h-screen bg-[#d4d0c8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Credit Review" subtitle="Broker and debtor risk assessments with approval indicators" group="Risk" neu />
        <NeuPageShell className="!min-h-0 custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-6">

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                { label: "Total Checks", value: stats.total, color: "blue" },
                { label: "Approved", value: stats.approved, color: "emerald" },
                { label: "Pending", value: stats.pending, color: "amber" },
                { label: "Declined", value: stats.declined, color: "red" },
                { label: "High / Critical", value: stats.highRisk, color: "orange" },
              ].map(s => (
                <RiskStatCard key={s.label} label={s.label} value={s.value} className="min-h-32 p-4" />
              ))}
            </div>

            {/* Main Card */}
            <Card className="ff-table-container ff-credit-checks-surface overflow-hidden border border-slate-200 bg-white dark:border-slate-800">
              <CardHeader className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-xl font-semibold text-slate-900 dark:text-white">Credit Assessments</CardTitle>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entity…" className="h-10 pl-9 w-56" />
                    </div>
                    <Select value={filterType} onValueChange={v => setFilterType(v as typeof filterType)}>
                      <SelectTrigger className="h-10 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="debtor">Debtors</SelectItem>
                        <SelectItem value="broker">Brokers</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                      <SelectTrigger className="h-10 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="approved_with_conditions">Conditional</SelectItem>
                        <SelectItem value="declined">Declined</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={() => setShowDialog(true)} className="h-10 px-4">
                      <Plus className="mr-1.5 h-4 w-4" /> New Check
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <ShieldCheck className="h-7 w-7 text-slate-400" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">No credit checks found</p>
                    <p className="mt-1 text-sm text-slate-500">Run your first assessment using the button above.</p>
                    <Button onClick={() => setShowDialog(true)} className="mt-6 h-10 px-5">
                      <Plus className="mr-1.5 h-4 w-4" /> New Credit Check
                    </Button>
                  </div>
                ) : (
                  <div className="custom-scrollbar overflow-x-auto">
                    <RiskTable className="ff-data-table w-full min-w-[880px]">
                      <thead>
                        <tr className="border-b border-slate-200/70 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                          {["Entity", "Type", "Risk Score", "Risk Tier", "Credit Limit", "Avg Days to Pay", "Status", "Actions"].map(h => (
                            <th key={h} className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(c => {
                          const risk = c.riskTier ? RISK_CONFIG[c.riskTier] : null;
                          const status = STATUS_CONFIG[c.status];
                          const RiskIcon = risk?.icon ?? Shield;
                          const StatusIcon = status.icon;
                          return (
                            <tr key={c.id} className="border-b border-slate-100/90 hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-900/30 transition-colors">
                              <td className="px-5 py-4">
                                <div className="font-semibold text-slate-900 dark:text-white">{c.entityName}</div>
                                {c.mcNumber && <div className="text-xs text-slate-500">MC: {c.mcNumber}</div>}
                              </td>
                              <td className="px-5 py-4">
                                <div className={`ff-badge ${c.entityType === "broker" ? "ff-badge-submitted" : "ff-badge-approved"}`}>
                                  {c.entityType === "broker" ? <Building2 className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
                                  <span className="capitalize">{c.entityType}</span>
                                </div>
                              </td>
                              <td className="px-5 py-4 w-36">{scoreBar(c.riskScore)}</td>
                              <td className="px-5 py-4">
                                {risk ? (
                                  <RiskBadge className={cn("ff-badge gap-1.5", risk.badge)}>
                                    <RiskIcon className="h-3 w-3" />
                                    {risk.label}
                                  </RiskBadge>
                                ) : <span className="text-slate-400 text-sm">—</span>}
                              </td>
                              <td className="px-5 py-4 text-sm font-semibold text-slate-900 dark:text-white">
                                {c.creditLimit ? `$${parseFloat(c.creditLimit).toLocaleString()}` : "—"}
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                                {c.avgDaysToPay ? (
                                  <span className={cn("font-medium", c.avgDaysToPay <= 30 ? "text-emerald-600" : c.avgDaysToPay <= 45 ? "text-amber-600" : "text-red-600")}>
                                    {c.avgDaysToPay}d
                                  </span>
                                ) : "—"}
                              </td>
                              <td className="px-5 py-4">
                                <RiskBadge className={cn("ff-badge gap-1.5", status.color)}>
                                  <StatusIcon className="h-3 w-3" />
                                  {status.label}
                                </RiskBadge>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex gap-1.5">
                                  {c.status === "pending" && (
                                    <>
                                      <Button
                                        size="sm"
                                        onClick={() => updateMutation.mutate({ id: c.id, status: "approved" })}
                                      >Approve</Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => updateMutation.mutate({ id: c.id, status: "declined" })}
                                      >Decline</Button>
                                    </>
                                  )}
                                  {c.status !== "pending" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => updateMutation.mutate({ id: c.id, status: "pending" })}
                                    >Re-review</Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </RiskTable>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </NeuPageShell>
      </div>

      {/* New Check Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="ff-credit-checks-surface max-w-lg">
          <DialogHeader>
            <DialogTitle>New Credit Assessment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Entity Type</Label>
                <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v as "broker" | "debtor", entityId: "" }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debtor">Debtor</SelectItem>
                    <SelectItem value="broker">Broker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Select {form.entityType === "debtor" ? "Debtor" : "Broker"}</Label>
                <Select value={form.entityId} onValueChange={v => setForm(f => ({ ...f, entityId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {entityOptions.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Risk Score (0–100)</Label>
                <Input type="number" min={0} max={100} value={form.riskScore} onChange={e => setForm(f => ({ ...f, riskScore: e.target.value }))} placeholder="e.g. 72" className="mt-1" />
              </div>
              <div>
                <Label>Risk Tier</Label>
                <Select value={form.riskTier} onValueChange={v => setForm(f => ({ ...f, riskTier: v as typeof f.riskTier }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Approved Credit Limit ($)</Label>
                <Input type="number" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} placeholder="e.g. 50000" className="mt-1" />
              </div>
              <div>
                <Label>Avg Days to Pay</Label>
                <Input type="number" value={form.avgDaysToPay} onChange={e => setForm(f => ({ ...f, avgDaysToPay: e.target.value }))} placeholder="e.g. 35" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Initial Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as typeof f.status }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="approved_with_conditions">Approved with Conditions</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Assessment notes, conditions, or risk factors…" className="mt-1" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create Assessment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { ProcessorAssignment } from "@/components/assignments/processor-assignment";
import BrokerEditDialog from "@/components/brokers/broker-edit-dialog";
import DumpStatementTimeline from "@/components/brokers/dump-statement-timeline";
import EntityNotes from "@/components/shared/EntityNotes";
import { BrokerFinancialOverview } from "@/components/brokers/broker-financial-overview";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuTab, NeuTabList, NeuTabPanel, NeuTabs, NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Award, AlertTriangle, Ban, Building2, CheckCircle2, Clock, Edit2, MapPin, MessageSquare, Plus, ReceiptText, RefreshCw, Trash2 } from "lucide-react";
import type { Broker } from "@shared/schema";

const TERMS_LABEL: Record<string, string> = {
  quickpay: "Quick Pay",
  net15: "Net 15",
  net30: "Net 30",
  net45: "Net 45",
  net60: "Net 60",
};

const formatMoney = (value: unknown) =>
  value == null || value === ""
    ? "—"
    : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

function gradeTone(grade?: string | null) {
  if (grade === "A") return "text-emerald-700";
  if (grade === "B") return "text-teal-700";
  if (grade === "C") return "text-yellow-700";
  if (grade === "D") return "text-orange-700";
  if (grade === "F") return "text-red-700";
  return "text-[#777]";
}

function CreditScorePanel({ brokerId, canRecalculate }: { brokerId: number; canRecalculate: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<{ current: any | null; history: any[] }>({
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
      const response = await fetch(`/api/brokers/${brokerId}/calculate-credit`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to recalculate credit");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "credit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      toast({ title: "Credit score recalculated" });
    },
    onError: (error: Error) =>
      toast({ title: "Unable to recalculate credit", description: error.message, variant: "destructive" }),
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
    <NeuCard className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c5c5c5] px-5 py-4">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-[#168d98]" />
          <h3 className="text-xs font-semibold text-[#354548]">Broker creditworthiness</h3>
        </div>
        {canRecalculate && (
          <NeuButton
            className="min-h-9 gap-1 rounded-lg px-3 text-[10px]"
            disabled={calculateMutation.isPending}
            onClick={() => calculateMutation.mutate()}
          >
            <RefreshCw className={`h-3 w-3 ${calculateMutation.isPending ? "animate-spin" : ""}`} />
            Recalculate
          </NeuButton>
        )}
      </div>
      <div className="space-y-4 p-5">
        {isLoading ? (
          <div className="space-y-3 py-3" aria-label="Loading credit report">
            <div className="h-5 w-36 animate-pulse rounded bg-[#d1d1d1]" />
            <div className="h-20 animate-pulse rounded-xl bg-[#d1d1d1]" />
          </div>
        ) : isError ? (
          <NeuNotice severity="block" role="alert" className="text-center text-xs">
            Credit report unavailable.
            <NeuButton className="ml-3 min-h-8 px-3 text-[10px]" onClick={() => refetch()}>Retry</NeuButton>
          </NeuNotice>
        ) : !report ? (
          <div className="rounded-xl bg-[#e0e0e0] p-5 text-center text-xs text-[#667477] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
            No credit score calculated yet.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div
                className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
                style={{ background: `conic-gradient(#27aab8 ${score * 3.6}deg, #d2d2d2 0deg)` }}
              >
                <div className="flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full bg-[#e0e0e0]">
                  <span className="text-2xl font-black text-[#354548]">{score}</span>
                  <span className="text-[9px] uppercase tracking-wide text-[#758587]">/ 100</span>
                </div>
              </div>
              <div>
                <NeuBadge className={`border-0 px-3 py-1 text-lg font-black ${gradeTone(grade)}`}>
                  {grade ?? "—"}
                </NeuBadge>
                <p className="mt-1 text-xs text-[#667477]">
                  {grade === "F" ? "Critical — do not factor" : grade === "D" ? "Poor — frequent delays or issues" : grade === "A" ? "Excellent — pay fast, no issues" : "Broker payment performance"}
                </p>
              </div>
            </div>
            <div className="space-y-2.5">
              {breakdown.map(([label, value, max]) => (
                <div key={String(label)}>
                  <div className="mb-1 flex justify-between text-[11px] font-medium text-[#667477]">
                    <span>{label}</span><span>{value} / {max}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#d2d2d2]">
                    <div className="h-full rounded-full bg-[#27aab8]" style={{ width: `${Math.min(100, Number(value) / Number(max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ["Avg Days to Pay", report.avgDaysToPayment ?? "—"],
                ["Total Invoices", report.totalInvoices ?? 0],
                ["Chargebacks", report.totalChargebacks ?? 0],
                ["Short Pays", report.totalShortPays ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-[#e0e0e0] px-2.5 py-2 shadow-[inset_2px_2px_5px_#c1c1c1,inset_-2px_-2px_5px_#ffffff]">
                  <p className="text-[#758587]">{label}</p>
                  <p className="mt-0.5 font-bold text-[#354548]">{value}</p>
                </div>
              ))}
            </div>
            {history.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#758587]">Credit history · last 12 months</p>
                <div className="flex h-16 items-end gap-1">
                  {history.slice(-12).map((item: any, index: number) => (
                    <div
                      key={`${item.id ?? item.lastCalculatedAt ?? index}`}
                      title={`${item.grade ?? "—"} · ${item.score ?? 0}`}
                      className="flex-1 rounded-t bg-[#27aab8]"
                      style={{ height: `${Math.max(8, Number(item.score ?? 0))}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-[#758587]">Last calculated: {formatDate(report.lastCalculatedAt)}</p>
          </>
        )}
      </div>
    </NeuCard>
  );
}

export default function BrokerDetail() {
  const { id } = useParams<{ id: string }>();
  const brokerId = Number(id);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin" || user?.role === "manager";
  const [profileTab, setProfileTab] = useState("overview");
  const [focusNoteId, setFocusNoteId] = useState<number | null>(null);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);
  const [branchDialog, setBranchDialog] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<number | null>(null);
  const [branchForm, setBranchForm] = useState({
    branchName: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    email: "",
    contactName: "",
    status: "active" as "active" | "inactive",
  });

  const { data: broker, isLoading, isError, refetch: refetchBroker } = useQuery<any>({
    queryKey: ["/api/brokers", brokerId],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${brokerId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Not found");
      return response.json();
    },
    enabled: !isNaN(brokerId),
  });
  const { data: allInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices", { all: true }],
    enabled: !isNaN(brokerId),
  });
  const { data: branches = [], isLoading: branchesLoading, isError: branchesError, refetch: refetchBranches } = useQuery<any[]>({
    queryKey: ["/api/brokers", brokerId, "branches"],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${brokerId}/branches`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load branches");
      return response.json();
    },
    enabled: !isNaN(brokerId),
  });
  const brokerInvoices = allInvoices.filter((invoice: any) =>
    invoice.brokerId != null ? invoice.brokerId === brokerId : invoice.debtorId === brokerId,
  );
  const creditLimit = Number(broker?.creditLimit ?? 0);
  const exposure = brokerInvoices.reduce((sum: number, invoice: any) => sum + Number(invoice.amount || 0), 0);
  const openCount = brokerInvoices.filter((invoice: any) => !["settled", "rejected"].includes(invoice.status)).length;
  const creditUtilPct = creditLimit && exposure ? Math.min(100, Math.round((exposure / creditLimit) * 100)) : 0;

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/brokers/${brokerId}`, { status }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/brokers", brokerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      setStatusDialog(false);
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });
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
      queryClient.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
      setBranchDialog(false);
    },
    onError: (error: Error) => toast({ title: "Failed to save branch", description: error.message, variant: "destructive" }),
  });
  const deleteBranchMutation = useMutation({
    mutationFn: (branchId: number) => apiRequest("DELETE", `/api/brokers/${brokerId}/branches/${branchId}`),
    onSuccess: () => {
      toast({ title: "Branch removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
    },
    onError: (error: Error) => toast({ title: "Failed to remove branch", description: error.message, variant: "destructive" }),
  });
  const toggleBranchMutation = useMutation({
    mutationFn: ({ branchId, status }: { branchId: number; status: "active" | "inactive" }) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}/branches/${branchId}`, { status }),
    onSuccess: () => {
      toast({ title: "Branch status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/brokers", brokerId, "branches"] });
    },
    onError: (error: Error) => toast({ title: "Failed to update branch status", description: error.message, variant: "destructive" }),
  });
  const openEditBroker = async () => {
    setLoadingEdit(true);
    try {
      const result = await refetchBroker({ throwOnError: true });
      if (!result.data || result.data.id !== brokerId) throw new Error("Broker information is unavailable.");
      setEditingBroker(result.data);
    } catch (error) {
      toast({
        title: "Unable to open broker editor",
        description: error instanceof Error ? error.message : "Failed to load broker.",
        variant: "destructive",
      });
    } finally {
      setLoadingEdit(false);
    }
  };
  const openBranchDialog = (branch?: any) => {
    setEditingBranchId(branch?.id ?? null);
    setBranchForm({
      branchName: branch?.branchName ?? "",
      address: branch?.address ?? "",
      city: branch?.city ?? "",
      state: branch?.state ?? "",
      zip: branch?.zip ?? "",
      phone: branch?.phone ?? "",
      email: branch?.email ?? "",
      contactName: branch?.contactName ?? "",
      status: branch?.status ?? "active",
    });
    setBranchDialog(true);
  };
  const terms = TERMS_LABEL[broker?.paymentTerms] ?? broker?.paymentTerms ?? "—";
  const grade = broker?.creditGrade as string | null | undefined;
  const gradeStyle = gradeTone(grade);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 bg-[#e0e0e0]">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopNav title="Broker profile" group="Risk" neu />
          <NeuPageShell className="!min-h-0 flex-1 p-5">
            <div className="mx-auto max-w-[1500px] animate-pulse space-y-5">
              <div className="h-28 rounded-2xl bg-[#d3d3d3]" />
              <div className="h-48 rounded-2xl bg-[#d3d3d3]" />
              <div className="h-64 rounded-2xl bg-[#d3d3d3]" />
            </div>
          </NeuPageShell>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#e0e0e0] text-[#354548]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Broker profile" subtitle="Relationship, credit terms, and linked invoices" group="Risk" neu />
        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1">
          <div className="mx-auto max-w-[1580px] space-y-5 p-4 md:p-6">
            {isError || !broker ? (
              <NeuCard className="flex flex-col items-center p-12 text-center">
                <Building2 className="mb-3 h-8 w-8 text-[#758587]" />
                <h1 className="font-semibold">Broker record unavailable</h1>
                <NeuButton className="mt-4" onClick={() => refetchBroker()}>Retry</NeuButton>
              </NeuCard>
            ) : (
              <>
                <NeuCard className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <NeuButton onClick={() => navigate("/brokers")} className="min-h-10 px-3 text-xs">
                      <Building2 className="h-4 w-4" />Brokers
                    </NeuButton>
                    <div className="h-10 w-px bg-[#c5c5c5]" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-semibold tracking-tight text-[#354548] md:text-2xl">{broker.name}</h1>
                        <NeuBadge tone={broker.status === "active" ? "success" : broker.status === "suspended" ? "warning" : "neutral"}>{broker.status}</NeuBadge>
                        <NeuBadge className={`font-bold ${gradeStyle}`}>Grade {grade || "—"}</NeuBadge>
                      </div>
                      <p className="mt-1 text-xs text-[#718187]">MC {broker.mcNumber || "Not recorded"} · DOT {broker.dotNumber || "Not recorded"} · {terms}</p>
                      <p className="mt-1 text-sm text-[#526164]">
                        {broker.contactPerson || "No contact recorded"} · {broker.email || "No email recorded"}{broker.phone ? ` · ${broker.phone}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <NeuBadge className="px-3 py-2 text-sm font-semibold">Credit limit&nbsp; {formatMoney(broker.creditLimit)}</NeuBadge>
                    <NeuButton disabled={loadingEdit} data-testid="broker-profile-edit" onClick={openEditBroker} className="min-h-10 px-3 text-xs">
                      <Edit2 className="h-4 w-4" />{loadingEdit ? "Loading…" : "Edit Broker"}
                    </NeuButton>
                    {isAdmin && broker.status === "active" && (
                      <NeuButton disabled={statusMutation.isPending} onClick={() => setStatusDialog(true)} className="min-h-10 px-3 text-xs text-[#a34e48]">
                        <Ban className="h-4 w-4" />Suspend
                      </NeuButton>
                    )}
                    {isAdmin && broker.status !== "active" && (
                      <NeuButton variant="accent" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("active")} className="min-h-10 px-3 text-xs">
                        <CheckCircle2 className="h-4 w-4" />Activate
                      </NeuButton>
                    )}
                    <div className="rounded-xl bg-[#e0e0e0] px-3 py-2 shadow-[inset_3px_3px_7px_#b8b8b8,inset_-3px_-3px_7px_#ffffff]">
                      <span className="block text-[9px] font-bold uppercase tracking-wide text-[#758587]">Assigned processor</span>
                      <ProcessorAssignment record={broker} endpoint={`/api/brokers/${brokerId}/assign`} queryKey={["/api/brokers", brokerId]} compact />
                    </div>
                  </div>
                  {creditUtilPct >= 90 && (
                    <div className="flex w-full items-center gap-2 rounded-xl bg-[#f3dfdd] px-4 py-3 text-sm font-semibold text-[#9b4943]">
                      <AlertTriangle className="h-4 w-4" />Credit utilisation is {creditUtilPct}% — approaching or exceeding the limit.
                    </div>
                  )}
                </NeuCard>

                <BrokerFinancialOverview brokerId={brokerId} />

                <NeuTabs value={profileTab} onValueChange={setProfileTab} className="space-y-4">
                  <NeuTabList className="w-full">
                    <NeuTab value="overview"><Building2 className="mr-2 inline h-4 w-4" />Overview</NeuTab>
                    <NeuTab value="invoices"><ReceiptText className="mr-2 inline h-4 w-4" />Invoices <span className="ml-2 text-xs">{brokerInvoices.length}</span></NeuTab>
                    <NeuTab value="branches"><MapPin className="mr-2 inline h-4 w-4" />Branches <span className="ml-2 text-xs">{branches.length}</span></NeuTab>
                    <NeuTab value="notes"><MessageSquare className="mr-2 inline h-4 w-4" />Notes</NeuTab>
                    <NeuTab value="credit"><Award className="mr-2 inline h-4 w-4" />Credit score</NeuTab>
                    <NeuTab value="timeline"><Clock className="mr-2 inline h-4 w-4" />Timeline</NeuTab>
                  </NeuTabList>

                  <NeuTabPanel value="overview" unmountInactive className="mt-0 p-4 md:p-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {[
                        { title: "Contact", rows: [["Contact person", broker.contactPerson], ["Email", broker.email], ["Phone", broker.phone]] },
                        { title: "Location", rows: [["Address", broker.address], ["City", broker.city], ["State / ZIP", [broker.state, broker.zipCode].filter(Boolean).join(" ")]] },
                        { title: "Broker credentials", rows: [["MC number", broker.mcNumber], ["DOT number", broker.dotNumber], ["Payment terms", terms]] },
                        { title: "Credit exposure", rows: [["Credit limit", formatMoney(broker.creditLimit)], ["Current volume", formatMoney(exposure)], ["Open invoices", openCount]] },
                        { title: "Record", rows: [["Status", broker.status], ["Created", formatDate(broker.createdAt)], ["Updated", formatDate(broker.updatedAt)]] },
                      ].map(section => (
                        <NeuCard key={section.title} className="p-4">
                          <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#758587]">{section.title}</h3>
                          <dl className="divide-y divide-[#c9c9c9]">
                            {section.rows.map(([label, value]) => (
                              <div key={label} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                                <dt className="text-[#758587]">{label}</dt>
                                <dd className="text-right font-semibold text-[#354548]">{value || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        </NeuCard>
                      ))}
                      <NeuCard className="p-4">
                        <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#758587]">Credit limit utilisation</p>
                        <div className="h-2 overflow-hidden rounded-full bg-[#d2d2d2] shadow-[inset_2px_2px_4px_#b9b9b9,inset_-2px_-2px_4px_#f5f5f5]">
                          <div className={`h-full rounded-full ${creditUtilPct >= 90 ? "bg-[#bd665e]" : "bg-[#27aab8]"}`} style={{ width: `${creditUtilPct}%` }} />
                        </div>
                        <p className="mt-2 text-sm font-semibold">{creditUtilPct}% of {formatMoney(broker.creditLimit)}</p>
                      </NeuCard>
                    </div>
                  </NeuTabPanel>

                  <NeuTabPanel value="invoices" unmountInactive className="mt-0 p-4 md:p-5">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#758587]">Linked records</p>
                        <h2 className="mt-1 text-lg font-semibold">Invoices</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <NeuBadge tone="accent">{brokerInvoices.length} records</NeuBadge>
                      </div>
                    </div>
                    {brokerInvoices.length ? (
                      <NeuTable className="min-w-[680px]">
                        <NeuTableHeader><tr>{["Invoice", "Date", "Amount", "Status"].map(label => <NeuTableHead key={label}>{label}</NeuTableHead>)}</tr></NeuTableHeader>
                        <NeuTableBody>
                          {brokerInvoices.map((invoice: any) => (
                            <NeuTableRow key={invoice.id} className="border-t border-[#c9c9c9]">
                              <NeuTableCell><a className="font-semibold text-[#168d98] hover:underline" href={`/invoices/${invoice.id}`}>{invoice.invoiceNumber || `Invoice ${invoice.id}`}</a></NeuTableCell>
                              <NeuTableCell>{formatDate(invoice.invoiceDate ?? invoice.createdAt)}</NeuTableCell>
                              <NeuTableCell className="font-semibold">{formatMoney(invoice.amount)}</NeuTableCell>
                              <NeuTableCell><NeuBadge tone={invoice.status === "funded" || invoice.status === "settled" ? "success" : invoice.status === "rejected" ? "warning" : "neutral"}>{String(invoice.status || "unknown").replace(/_/g, " ")}</NeuBadge></NeuTableCell>
                            </NeuTableRow>
                          ))}
                        </NeuTableBody>
                      </NeuTable>
                    ) : (
                      <NeuCard className="p-10 text-center">
                        <ReceiptText className="mx-auto mb-2 h-7 w-7 text-[#849395]" />
                        <p className="font-semibold">No invoices linked to this broker</p>
                        <p className="mt-1 text-sm text-[#758587]">Invoices associated with this broker will appear here.</p>
                      </NeuCard>
                    )}
                  </NeuTabPanel>

                  <NeuTabPanel value="branches" unmountInactive className="mt-0 p-4 md:p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#758587]">Operating locations</p><h2 className="mt-1 text-lg font-semibold">Broker branches</h2></div>
                      {isAdmin && <NeuButton variant="accent" onClick={() => openBranchDialog()} className="min-h-10 px-3 text-xs"><Plus className="h-4 w-4" />Add branch</NeuButton>}
                    </div>
                    {branchesLoading ? (
                      <div className="space-y-3">{[1, 2, 3].map(row => <div key={row} className="h-16 animate-pulse rounded-xl bg-[#d1d1d1]" />)}</div>
                    ) : branchesError ? (
                      <NeuCard className="p-6 text-center"><p className="font-semibold">Unable to load branches</p><NeuButton className="mt-3" onClick={() => refetchBranches()}>Retry</NeuButton></NeuCard>
                    ) : branches.length ? (
                      <NeuTable className="min-w-[1050px]">
                        <NeuTableHeader><tr>{["Branch", "Address", "City", "State", "ZIP", "Phone", "Email", "Contact", "Status", "Actions"].map(label => <NeuTableHead key={label}>{label}</NeuTableHead>)}</tr></NeuTableHeader>
                        <NeuTableBody>
                          {branches.map((branch: any) => (
                            <NeuTableRow key={branch.id} className="border-t border-[#c9c9c9]">
                              <NeuTableCell className="font-semibold">{branch.branchName}</NeuTableCell>
                              <NeuTableCell>{branch.address || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.city || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.state || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.zip || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.phone || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.email || "—"}</NeuTableCell>
                              <NeuTableCell>{branch.contactName || "—"}</NeuTableCell>
                              <NeuTableCell><NeuBadge tone={branch.status === "active" ? "success" : "neutral"}>{branch.status}</NeuBadge></NeuTableCell>
                              <NeuTableCell>{isAdmin ? (
                                <div className="flex flex-wrap gap-1">
                                  <NeuButton aria-label={`Edit ${branch.branchName}`} onClick={() => openBranchDialog(branch)} className="h-9 min-h-9 w-9 rounded-lg p-0"><Edit2 className="h-4 w-4" /></NeuButton>
                                  <NeuButton disabled={toggleBranchMutation.isPending} onClick={() => toggleBranchMutation.mutate({ branchId: branch.id, status: branch.status === "active" ? "inactive" : "active" })} className="h-9 min-h-9 px-2 text-[10px]">{branch.status === "active" ? "Deactivate" : "Activate"}</NeuButton>
                                  <NeuButton disabled={deleteBranchMutation.isPending} aria-label={`Remove ${branch.branchName}`} onClick={() => { if (window.confirm(`Remove ${branch.branchName}?`)) deleteBranchMutation.mutate(branch.id); }} className="h-9 min-h-9 w-9 rounded-lg p-0 text-[#a34e48]"><Trash2 className="h-4 w-4" /></NeuButton>
                                </div>
                              ) : "—"}</NeuTableCell>
                            </NeuTableRow>
                          ))}
                        </NeuTableBody>
                      </NeuTable>
                    ) : (
                      <NeuCard className="p-10 text-center"><MapPin className="mx-auto mb-2 h-7 w-7 text-[#849395]" /><p className="font-semibold">No branches on file</p><p className="mt-1 text-sm text-[#758587]">Branch contacts and operating locations will appear here.</p></NeuCard>
                    )}
                  </NeuTabPanel>

                  <NeuTabPanel value="notes" unmountInactive className="mt-0 p-4 md:p-5">
                    <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#758587]">Internal record</p><h2 className="mt-1 text-lg font-semibold">Broker notes</h2></div>
                    {broker.notes && <NeuCard className="mb-5 whitespace-pre-wrap p-4 text-sm leading-6"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#758587]">Legacy profile note · read-only</p>{broker.notes}</NeuCard>}
                    <EntityNotes key={`broker:${brokerId}`} entityType="broker" entityId={brokerId} focusNoteId={focusNoteId} onFocused={() => setFocusNoteId(null)} />
                  </NeuTabPanel>

                  <NeuTabPanel value="credit" unmountInactive className="mt-0 p-4 md:p-5"><CreditScorePanel brokerId={brokerId} canRecalculate={isAdmin} /></NeuTabPanel>
                  <NeuTabPanel value="timeline" unmountInactive className="mt-0 p-4 md:p-5"><DumpStatementTimeline brokerId={brokerId} neuStyle onOpenNote={noteId => { setFocusNoteId(noteId ?? 0); setProfileTab("notes"); }} /></NeuTabPanel>
                </NeuTabs>
              </>
            )}
          </div>
        </NeuPageShell>
      </div>
      {editingBroker?.id === brokerId && <BrokerEditDialog broker={editingBroker} onClose={() => setEditingBroker(null)} />}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="rounded-2xl border-0 bg-[#e0e0e0] text-[#354548] shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8]">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5 text-[#a34e48]" />Suspend broker</DialogTitle></DialogHeader>
          <DialogDescription className="text-[#667477]">Suspending this broker will flag all linked invoices. Are you sure?</DialogDescription>
          <DialogFooter>
            <NeuButton onClick={() => setStatusDialog(false)}>Cancel</NeuButton>
            <NeuButton variant="accent" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("suspended")}>{statusMutation.isPending ? "Suspending…" : "Confirm suspend"}</NeuButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={branchDialog} onOpenChange={setBranchDialog}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#354548] shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8]">
          <DialogHeader><DialogTitle>{editingBranchId ? "Edit branch" : "Add branch"}</DialogTitle><DialogDescription>Store the branch contact and location used for broker invoices.</DialogDescription></DialogHeader>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); if (branchForm.branchName.trim()) branchMutation.mutate(); }}>
            {([
              ["branchName", "Branch name", true],
              ["address", "Address", false],
              ["city", "City", false],
              ["state", "State", false],
              ["zip", "ZIP", false],
              ["phone", "Phone", false],
              ["email", "Email", false],
              ["contactName", "Contact name", false],
            ] as const).map(([key, label, required]) => (
              <label key={key} className={`space-y-1.5 text-xs font-semibold text-[#647275] ${key === "address" ? "sm:col-span-2" : ""}`} htmlFor={`branch-${key}`}>
                {label}{required ? " *" : ""}
                <NeuInput id={`branch-${key}`} required={required} type={key === "email" ? "email" : "text"} value={branchForm[key]} onChange={event => setBranchForm(form => ({ ...form, [key]: event.target.value }))} className="min-h-10 text-sm" />
              </label>
            ))}
            <label className="space-y-1.5 text-xs font-semibold text-[#647275]">
              Status
              <NeuSelect value={branchForm.status} onChange={event => setBranchForm(form => ({ ...form, status: event.target.value as "active" | "inactive" }))} className="min-h-10">
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </NeuSelect>
            </label>
            <DialogFooter className="sm:col-span-2">
              <NeuButton type="button" onClick={() => setBranchDialog(false)}>Cancel</NeuButton>
              <NeuButton type="submit" variant="accent" disabled={branchMutation.isPending || !branchForm.branchName.trim()}>
                {branchMutation.isPending ? "Saving…" : editingBranchId ? "Save changes" : "Add branch"}
              </NeuButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

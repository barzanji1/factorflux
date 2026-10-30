import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FFOnboarding } from "@/components/ui/ff-onboarding";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { useSavedViews, type SavedView } from "@/hooks/use-saved-views";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { brokerFormSchema, type BrokerFormData } from "@/components/brokers/broker-form-schema";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { ProcessorIdentity } from "@/components/assignments/processor-assignment";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuStatCard, NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { 
  Building, 
  Plus, 
  Edit, 
  Trash2, 
  TrendingUp,
  DollarSign,
  ExternalLink,
  Search,
  ArrowUpDown,
  ShieldAlert,
} from "lucide-react";

interface Broker {
  id: number;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  mcNumber?: string;
  dotNumber?: string;
  dba?: string;
  creditLimit?: number;
  paymentTerms: string;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  assignedProcessor?: string | null;
  assignedProcessorUser?: {
    id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
    role?: string;
  } | null;
  creditGrade?: "A" | "B" | "C" | "D" | "F" | null;
  creditScore?: number | null;
}

interface BrokersResponse {
  data: Broker[];
  total: number;
  page: number;
  totalPages: number;
}

function getBrokerDba(broker: Broker) {
  if (broker.dba) return broker.dba;
  return broker.notes?.match(/(?:^|\n)DBA:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || "—";
}

export default function Brokers() {
  const [isBrokerDialogOpen, setIsBrokerDialogOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [processorFilter, setProcessorFilter] = useState<"all" | "me">("me");
  const [creditGradeFilter, setCreditGradeFilter] = useState<"all" | "A" | "B" | "C" | "D" | "F">("all");
  const [creditSort, setCreditSort] = useState<"none" | "asc" | "desc">("none");

  // Saved views
  const { allViews: savedViews } = useSavedViews("brokers");

  function applyView(view: SavedView) {
    if (view.filters.status) setStatusFilter(view.filters.status);
    if (view.filters.terms) setStatusFilter("quickpay_" + view.filters.terms);
    setPage(1);
    setActiveViewId(view.id);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);
  useEffect(() => {
    setProcessorFilter(isManager ? "all" : "me");
  }, [isManager]);

  // Fetch brokers server-side. Keep the payment terms filter separate from
  // status so saved views can continue to express either kind of filter.
  const statusQuery = ["active", "inactive", "suspended"].includes(statusFilter)
    ? statusFilter
    : undefined;
  const paymentTermsQuery = statusFilter === "quickpay"
    ? "quickpay"
    : statusFilter.startsWith("quickpay_")
      ? statusFilter.slice("quickpay_".length)
      : undefined;
  const { data: brokersResponse, isLoading, isError, refetch } = useQuery<BrokersResponse>({
    queryKey: ["/api/brokers", page, debouncedSearch, statusQuery, paymentTermsQuery, processorFilter, creditGradeFilter, creditSort],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        q: debouncedSearch,
      });
      if (statusQuery) params.set("status", statusQuery);
      if (paymentTermsQuery) params.set("paymentTerms", paymentTermsQuery);
      if (processorFilter === "me") params.set("processor", "me");
      if (creditGradeFilter !== "all") params.set("creditGrade", creditGradeFilter);
      if (creditSort !== "none") params.set("creditSort", creditSort);
      const response = await fetch(`/api/brokers?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch brokers");
      return response.json();
    },
  });
  const brokers = brokersResponse?.data ?? [];
  const visibleBrokers = brokers;
  const totalBrokers = brokersResponse?.total ?? 0;
  const totalPages = brokersResponse?.totalPages ?? 1;
  const gradeRank: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const gradedBrokers = brokers.filter((broker) => broker.creditGrade && broker.creditGrade in gradeRank);
  const averageGradeMean = gradedBrokers.length
    ? gradedBrokers.reduce((sum, broker) => sum + gradeRank[broker.creditGrade!], 0) / gradedBrokers.length
    : null;
  const averageGrade = averageGradeMean === null
    ? "—"
    : (["F", "D", "C", "B", "A"][Math.round(averageGradeMean)] ?? "—");
  const averageGradeLabel = averageGradeMean === null
    ? "No graded brokers"
    : `Mean rank ${averageGradeMean.toFixed(1)} · A=4 to F=0`;
  const currentPageRange = `${totalBrokers === 0 ? 0 : (page - 1) * 50 + 1}–${Math.min(page * 50, totalBrokers)}`;

  // Broker form
  const form = useForm<BrokerFormData>({
    resolver: zodResolver(brokerFormSchema),
    defaultValues: {
      paymentTerms: "net30",
      status: "active",
      creditLimit: 0,
    },
  });

  // Create broker mutation
  const createBrokerMutation = useMutation({
    mutationFn: async (data: BrokerFormData) => {
      const response = await fetch("/api/brokers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create broker");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      setIsBrokerDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Broker created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create broker", variant: "destructive" });
    },
  });

  // Update broker mutation
  const updateBrokerMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<BrokerFormData> }) => {
      const response = await fetch(`/api/brokers/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data.updates),
      });
      if (!response.ok) throw new Error("Failed to update broker");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      setEditingBroker(null);
      setIsBrokerDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Broker updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update broker", variant: "destructive" });
    },
  });

  // Delete broker mutation
  const deleteBrokerMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/brokers/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete broker");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      toast({ title: "Success", description: "Broker deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete broker", variant: "destructive" });
    },
  });

  const onSubmit = (data: BrokerFormData) => {
    if (editingBroker) {
      updateBrokerMutation.mutate({ id: editingBroker.id, updates: data });
    } else {
      createBrokerMutation.mutate(data);
    }
  };

  const openCreateDialog = () => {
    setEditingBroker(null);
    form.reset({
      paymentTerms: "net30",
      status: "active",
      creditLimit: 0,
    });
    setIsBrokerDialogOpen(true);
  };

  const openEditDialog = (broker: Broker) => {
    setEditingBroker(broker);
    form.reset({
      name: broker.name,
      contactPerson: broker.contactPerson,
      email: broker.email,
      phone: broker.phone,
      address: broker.address || "",
      city: broker.city || "",
      state: broker.state || "",
      zipCode: broker.zipCode || "",
      mcNumber: broker.mcNumber || "",
      dotNumber: broker.dotNumber || "",
      creditLimit: broker.creditLimit || 0,
      paymentTerms: broker.paymentTerms as any,
      status: broker.status as any,
      notes: broker.notes || "",
    });
    setIsBrokerDialogOpen(true);
  };

  const getBrokerBadge = (status: string) => {
    switch (status) {
      case "active":    return "ff-badge ff-badge-paid";
      case "inactive":  return "ff-badge ff-badge-draft";
      case "suspended": return "ff-badge ff-badge-rejected";
      default:          return "ff-badge ff-badge-draft";
    }
  };

  const getPaymentTermsLabel = (terms: string) => {
    switch (terms) {
      case "net15":
        return "Net 15";
      case "net30":
        return "Net 30";
      case "net45":
        return "Net 45";
      case "net60":
        return "Net 60";
      case "quickpay":
        return "Quick Pay";
      default:
        return terms;
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Broker Desk" subtitle="Freight broker relationships, contacts, and risk ratings" group="Risk" neu />
        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1680px] space-y-6 p-4 md:p-7 xl:p-9">
        {/* ── Stats strip ──────────────────────────────────────────────── */}
        <section aria-label="Broker portfolio snapshot">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#758587]">Portfolio snapshot</p><h2 className="mt-1 text-lg font-semibold text-[#354548]">Broker relationships</h2></div>
            <p className="text-xs text-[#7b898a]">Status and grade figures reflect this page · {currentPageRange} of {totalBrokers}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <NeuStatCard label="Total brokers" value={totalBrokers} detail="Across this filtered directory" icon={<Building className="h-5 w-5" />} className="min-h-32 p-4" />
            <NeuStatCard label="Active · this page" value={brokers.filter(b => b.status === "active").length} detail="Current page only" icon={<TrendingUp className="h-5 w-5" />} className="min-h-32 p-4" />
            <NeuStatCard label="Suspended · this page" value={brokers.filter(b => b.status === "suspended").length} detail="Current page only" icon={<ShieldAlert className="h-5 w-5" />} className="min-h-32 p-4" />
            <NeuStatCard label="Average credit grade" value={averageGrade} detail={`${averageGradeLabel} · this page`} icon={<DollarSign className="h-5 w-5" />} className="min-h-32 p-4" />
          </div>
        </section>

        {/* ── Search + filter bar ──────────────────────────────────────── */}
        <NeuCard className="overflow-hidden p-4 sm:p-5">
          {/* Saved view pills */}
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[#c5c5c5] pb-3">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-[#758587]">Saved views</span>
            {savedViews.map(view => (
              <NeuButton
                key={view.id}
                type="button"
                onClick={() => applyView(view)}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-xs ${
                  activeViewId === view.id
                    ? "text-[#168d98]"
                    : "text-[#586668]"
                }`}
              >
                {view.label}
              </NeuButton>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788b8d]" />
              <NeuInput
                placeholder="Search by name, MC#, DOT#, contact, or email…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-brokers"
                className="pl-11"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <NeuSelect aria-label="Broker assignment" value={processorFilter} onChange={e => { setProcessorFilter(e.target.value as "all" | "me"); setPage(1); }} className="w-auto min-w-36">
                {isManager ? <><option value="all">All brokers</option><option value="me">My brokers</option></> : <option value="me">My brokers</option>}
              </NeuSelect>
              <NeuSelect aria-label="Broker status and payment terms" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); setActiveViewId(null); }} className="w-auto min-w-40">
                <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
                <option value="quickpay">Quick Pay</option>{["net15", "net30", "net45", "net60"].map(term => <option key={term} value={`quickpay_${term}`}>{getPaymentTermsLabel(term)}</option>)}
              </NeuSelect>
              <NeuSelect aria-label="Credit grade" value={creditGradeFilter} onChange={e => { setCreditGradeFilter(e.target.value as typeof creditGradeFilter); setPage(1); }} className="w-auto min-w-32">
                <option value="all">All grades</option>{["A", "B", "C", "D", "F"].map(grade => <option key={grade} value={grade}>Grade {grade}</option>)}
              </NeuSelect>
             <button type="button" onClick={() => { setCreditSort(value => value === "none" ? "desc" : value === "desc" ? "asc" : "none"); setPage(1); }}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-[#e0e0e0] px-3 text-xs font-semibold text-[#425153] shadow-[4px_4px_9px_#c1c1c1,-4px_-4px_9px_#ffffff]"
               title={creditSort === "none" ? "Sort by credit score" : `Credit score ${creditSort === "asc" ? "ascending" : "descending"}`}>
                <ArrowUpDown className="h-4 w-4" /> Score{creditSort !== "none" ? ` ${creditSort}` : ""}
             </button>
             <NeuButton
              type="button"
              onClick={openCreateDialog}
              data-testid="button-create-broker"
               variant="accent"
               className="min-h-11 px-4 text-xs"
            >
               <Plus className="h-4 w-4" />Add Broker
             </NeuButton>
            </div>
          </div>
        </NeuCard>

        {/* ── Broker table ─────────────────────────────────────────────── */}
        <NeuCard className="overflow-hidden p-4 sm:p-5">
          {isLoading ? (
             <div className="space-y-3 p-2">
               {[1, 2, 3, 4, 5].map((row) => (
                 <div key={row} className="flex animate-pulse items-center gap-4">
                   <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 flex-1 rounded bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 w-1/6 rounded bg-slate-200 dark:bg-slate-800" />
                 </div>
               ))}
            </div>
            ) : isError ? (
             <div className="flex flex-col items-center py-14 text-center">
               <Building className="mb-3 h-8 w-8 text-[#788b8d]" />
               <p className="font-semibold text-[#354548]">Broker records did not load</p>
               <p className="mt-1 text-sm text-[#758587]">Check your connection and try again.</p>
               <NeuButton className="mt-4 min-h-10 px-4 text-xs" onClick={() => refetch()}>Retry</NeuButton>
             </div>
            ) : brokers.length === 0 ? (
             <div className="px-4 py-8">
               {totalBrokers === 0 && !debouncedSearch && statusFilter === "all" ? (
                <FFOnboarding
                  title="No brokers yet"
                  description="Add freight broker contacts to track relationships, credit limits, and payment terms in one place."
                  icon={Building}
                  steps={[
                    { label: "Add your first broker with contact details", detail: "Name, email, phone, and MC/DOT number" },
                    { label: "Set payment terms and credit limit", detail: "Net 15, 30, 45, 60, or Quick Pay" },
                    { label: "Link brokers to loads and invoices for tracking" },
                    { label: "Monitor broker status — active, inactive, or suspended" },
                  ]}
                  primaryAction={{ label: "Add First Broker", onClick: openCreateDialog }}
                  hint="Tip: Quick Pay brokers are flagged separately so your team can prioritize them."
                />
              ) : (
                 <div className="py-8 text-center">
                  <Building className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No brokers match your search</p>
                  <button
                    type="button"
                     onClick={() => { setSearchTerm(""); setStatusFilter("all"); setPage(1); setActiveViewId(null); }}
                    className="mt-2 text-[12px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Clear filters
                  </button>
                </div>
              )}
               {(totalBrokers === 0 || brokers.length === 0) && (
                 <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                   <span className="mr-2 text-[11.5px] text-slate-400">Showing 0-0 of {totalBrokers} brokers</span>
                   <Button type="button" variant="outline" size="sm" disabled>Previous</Button>
                   <Button type="button" variant="outline" size="sm" disabled>Next</Button>
                 </div>
               )}
            </div>
           ) : (
             <div>
               <NeuTable className="min-w-[980px]">
                 <NeuTableHeader>
                  <tr>
                     {["Broker Name", "MC#", "DOT#", "DBA", "Status", "Credit Grade", "Score", "Email", "Phone", "Assigned To", "Actions"].map((label) => <NeuTableHead key={label}>{label}</NeuTableHead>)}
                  </tr>
                 </NeuTableHeader>
                 <NeuTableBody>
                    {visibleBrokers.map((broker) => (
                     <NeuTableRow
                      key={broker.id}
                        className={`${broker.status === "suspended" ? "bg-[#f6e4e2]" : broker.status === "inactive" ? "bg-[#dedede]" : ""}`}
                    >
                       <NeuTableCell>
                        <div className="flex items-center gap-2">
                           <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d5e7e7]">
                             <Building className="h-4 w-4 text-[#168d98]" />
                          </div>
                           <p className="font-semibold text-[#354548]">{broker.name}</p>
                        </div>
                       </NeuTableCell>
                       <NeuTableCell className="font-mono text-xs">{broker.mcNumber || "—"}</NeuTableCell>
                       <NeuTableCell className="font-mono text-xs">{broker.dotNumber || "—"}</NeuTableCell>
                       <NeuTableCell>{getBrokerDba(broker)}</NeuTableCell>
                       <NeuTableCell><NeuBadge tone={broker.status === "active" ? "success" : broker.status === "suspended" ? "warning" : "neutral"}>{broker.status}</NeuBadge></NeuTableCell>
                       <NeuTableCell><NeuBadge className={`min-w-8 justify-center px-2 font-bold ${
                         broker.creditGrade === "A" ? "text-emerald-700" :
                         broker.creditGrade === "B" ? "text-teal-700" :
                         broker.creditGrade === "C" ? "text-yellow-700" :
                         broker.creditGrade === "D" ? "text-orange-700" :
                         broker.creditGrade === "F" ? "text-red-700" : "text-[#777]"
                       }`}>{broker.creditGrade ?? "—"}</NeuBadge></NeuTableCell>
                       <NeuTableCell className="font-mono text-xs font-semibold">{broker.creditScore ?? "—"}</NeuTableCell>
                       <NeuTableCell>{broker.email || "—"}</NeuTableCell>
                       <NeuTableCell>{broker.phone || "—"}</NeuTableCell>
                       <NeuTableCell><ProcessorIdentity person={broker.assignedProcessorUser} compact /></NeuTableCell>
                       <NeuTableCell>
                        <div className="flex items-center gap-1">
                           <NeuButton
                            type="button"
                            onClick={() => navigate(`/brokers/${broker.id}`)}
                             className="h-9 min-h-9 rounded-lg px-2.5 text-[11px] text-[#168d98]"
                          >
                             <ExternalLink className="h-3.5 w-3.5" />View
                           </NeuButton>
                           <NeuButton
                            type="button"
                            onClick={() => openEditDialog(broker)}
                            data-testid={`button-edit-${broker.id}`}
                             aria-label={`Edit ${broker.name}`}
                             className="h-9 min-h-9 w-9 rounded-lg p-0 text-[#667477]"
                          >
                             <Edit className="h-4 w-4" />
                           </NeuButton>
                          {isManager && (
                             <NeuButton
                              type="button"
                              onClick={() => { if (confirm("Delete this broker?")) deleteBrokerMutation.mutate(broker.id); }}
                              data-testid={`button-delete-${broker.id}`}
                               aria-label={`Delete ${broker.name}`}
                               className="h-9 min-h-9 w-9 rounded-lg p-0 text-[#a34e48]"
                            >
                               <Trash2 className="h-4 w-4" />
                             </NeuButton>
                          )}
                        </div>
                       </NeuTableCell>
                     </NeuTableRow>
                  ))}
                 </NeuTableBody>
               </NeuTable>
               <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#c5c5c5] px-1 pt-3">
                  <span className="text-xs text-[#758587]">
                   Showing {totalBrokers === 0 ? 0 : (page - 1) * 50 + 1}-{Math.min(page * 50, totalBrokers)} of {totalBrokers} brokers
                 </span>
                 <span className="text-xs text-[#758587]">
                   ${brokers.reduce((s, b) => s + (b.creditLimit || 0), 0).toLocaleString()} total credit
                </span>
              </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <NeuButton
                   type="button"
                    className="min-h-10 px-3 text-xs"
                   disabled={page <= 1 || isLoading}
                   onClick={() => setPage(currentPage => Math.max(1, currentPage - 1))}
                 >
                   Previous
                  </NeuButton>
                  <span className="px-2 text-xs text-[#758587]">Page {page} of {totalPages}</span>
                  <NeuButton
                   type="button"
                    className="min-h-10 px-3 text-xs"
                   disabled={page >= totalPages || isLoading}
                   onClick={() => setPage(currentPage => Math.min(totalPages, currentPage + 1))}
                 >
                   Next
                  </NeuButton>
               </div>
            </div>
          )}
        </NeuCard>
      </div>
        </NeuPageShell>

      {/* Create/Edit Broker Dialog */}
      <Dialog open={isBrokerDialogOpen} onOpenChange={setIsBrokerDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#354548] shadow-[-10px_-10px_24px_#ffffff,10px_10px_24px_#b8b8b8]">
          <DialogHeader>
            <DialogTitle>
              {editingBroker ? "Edit Broker" : "Add New Broker"}
            </DialogTitle>
            <DialogDescription>
              {editingBroker ? "Update broker information" : "Add a new freight broker to your network"}
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Broker Name *</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="Broker legal name" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person *</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="Primary contact" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <NeuInput type="email" placeholder="contact@broker.com" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone *</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="(555) 123-4567" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <NeuInput placeholder="Street address" {...field} className="min-h-10 text-sm" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="City" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="State" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="ZIP code" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="mcNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MC Number</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="MC number" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dotNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>DOT Number</FormLabel>
                      <FormControl>
                        <NeuInput placeholder="DOT number" {...field} className="min-h-10 text-sm" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="creditLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit Limit</FormLabel>
                      <FormControl>
                        <NeuInput
                          type="number"
                          placeholder="50000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                          className="min-h-10 text-sm"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Terms</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="min-h-10 rounded-xl border-0 bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                            <SelectValue placeholder="Select terms" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="quickpay">Quick Pay</SelectItem>
                          <SelectItem value="net15">Net 15</SelectItem>
                          <SelectItem value="net30">Net 30</SelectItem>
                          <SelectItem value="net45">Net 45</SelectItem>
                          <SelectItem value="net60">Net 60</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={(value) => field.onChange(value || "active")} value={field.value || "active"}>
                        <FormControl>
                          <SelectTrigger className="min-h-10 rounded-xl border-0 bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes about this broker..."
                        rows={3}
                        {...field}
                        className="rounded-xl border-0 bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff] focus-visible:ring-[#27aab8]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <NeuButton type="button" onClick={() => setIsBrokerDialogOpen(false)}>
                  Cancel
                </NeuButton>
                <NeuButton type="submit" variant="accent" disabled={createBrokerMutation.isPending || updateBrokerMutation.isPending}>
                  {editingBroker ? "Update Broker" : "Create Broker"}
                </NeuButton>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
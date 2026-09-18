import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { ProcessorIdentity } from "@/components/assignments/processor-assignment";
import { 
  Building, 
  Plus, 
  Edit, 
  Trash2, 
  Eye, 
  Phone, 
  Mail, 
  MapPin,
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
  ExternalLink,
  Search,
} from "lucide-react";

// Broker form schema
const brokerFormSchema = z.object({
  name: z.string().min(1, "Broker name is required"),
  contactPerson: z.string().min(1, "Contact person is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  mcNumber: z.string().optional(),
  dotNumber: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.enum(["net15", "net30", "net45", "net60", "quickpay"]).default("net30"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  notes: z.string().optional(),
});

type BrokerFormData = z.infer<typeof brokerFormSchema>;

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
  const { data: brokersResponse, isLoading } = useQuery<BrokersResponse>({
    queryKey: ["/api/brokers", page, debouncedSearch, statusQuery, paymentTermsQuery, processorFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        q: debouncedSearch,
      });
      if (statusQuery) params.set("status", statusQuery);
      if (paymentTermsQuery) params.set("paymentTerms", paymentTermsQuery);
      if (processorFilter === "me") params.set("processor", "me");
      const response = await fetch(`/api/brokers?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch brokers");
      return response.json();
    },
  });
  const brokers = brokersResponse?.data ?? [];
  const totalBrokers = brokersResponse?.total ?? 0;
  const totalPages = brokersResponse?.totalPages ?? 1;

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
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Broker Desk" subtitle="Freight broker relationships, contacts, and risk ratings" group="Risk" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
        {/* ── Stats strip ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
            {[
             { label: "Total Brokers",      value: totalBrokers,                                           icon: Building    },
            { label: "Current page active",             value: brokers.filter(b => b.status === "active").length,       icon: TrendingUp  },
            { label: "Current page credit limit", value: `$${brokers.reduce((s,b) => s+(b.creditLimit||0), 0).toLocaleString()}`, icon: DollarSign },
            { label: "Current page quick pay",          value: brokers.filter(b => b.paymentTerms === "quickpay").length, icon: Calendar  },
          ].map(s => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-[12px] border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{s.label}</p>
                <p className="mt-0.5 text-[22px] font-bold tracking-tight text-slate-900 dark:text-white">{s.value}</p>
              </div>
            );
          })}
        </div>

        {/* ── Search + filter bar ──────────────────────────────────────── */}
        <div className="mb-5 overflow-hidden rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
          {/* Saved view pills */}
          <div className="flex items-center gap-1.5 px-5 pt-3 pb-1.5 border-b border-slate-100 dark:border-slate-800">
            <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-600">Views</span>
            {savedViews.map(view => (
              <button
                key={view.id}
                type="button"
                onClick={() => applyView(view)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors ${
                  activeViewId === view.id
                    ? "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-400"
                }`}
              >
                <span>{view.emoji}</span> {view.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by name, MC#, DOT#, contact, or email…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-brokers"
                className="h-8 rounded-full pl-9 text-[12px]"
              />
            </div>
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
              {isManager && <button type="button" onClick={() => { setProcessorFilter("all"); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${processorFilter === "all" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500"}`}>All Brokers</button>}
              <button type="button" onClick={() => { setProcessorFilter("me"); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold ${processorFilter === "me" ? "bg-blue-600 text-white" : "text-slate-500"}`}>My Brokers</button>
            </div>
            <div className="flex gap-1.5">
              {(["all","active","suspended","inactive"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                   onClick={() => { setStatusFilter(s); setPage(1); setActiveViewId(null); }}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-semibold transition-colors capitalize ${
                    statusFilter === s
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {s === "all" ? `All ${brokers.length}` : s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openCreateDialog}
              data-testid="button-create-broker"
              className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-3 w-3" /> Add Broker
            </button>
          </div>
        </div>

        {/* ── Broker table ─────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-[14px] border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-[hsl(var(--card))]">
          {isLoading ? (
             <div className="space-y-3 p-5">
               {[1, 2, 3, 4, 5].map((row) => (
                 <div key={row} className="flex animate-pulse items-center gap-4">
                   <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 flex-1 rounded bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 w-1/4 rounded bg-slate-200 dark:bg-slate-800" />
                   <div className="h-4 w-1/6 rounded bg-slate-200 dark:bg-slate-800" />
                 </div>
               ))}
            </div>
           ) : brokers.length === 0 ? (
            <div className="px-8 py-10">
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
            <div className="overflow-x-auto">
              <table className="ff-data-table w-full min-w-[980px]">
                <thead>
                  <tr>
                    <th>Broker Name</th>
                    <th>MC#</th>
                    <th>DOT#</th>
                    <th>DBA</th>
                    <th>Status</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Assigned To</th>
                    <th className="pr-5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                   {brokers.map((broker) => (
                    <tr
                      key={broker.id}
                      className={broker.status === "suspended" ? "ff-row-urgent" : broker.status === "inactive" ? "ff-row-stale" : ""}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/20">
                            <Building className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <p className="font-medium text-slate-900 dark:text-white">{broker.name}</p>
                        </div>
                      </td>
                      <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{broker.mcNumber || "—"}</td>
                      <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{broker.dotNumber || "—"}</td>
                      <td className="text-slate-700 dark:text-slate-300">{getBrokerDba(broker)}</td>
                      <td>
                        <span className={getBrokerBadge(broker.status)}>
                          {broker.status.charAt(0).toUpperCase() + broker.status.slice(1)}
                        </span>
                      </td>
                      <td className="text-slate-600 dark:text-slate-400">{broker.email || "—"}</td>
                      <td className="text-slate-600 dark:text-slate-400">{broker.phone || "—"}</td>
                      <td><ProcessorIdentity person={broker.assignedProcessorUser} compact /></td>
                      <td className="pr-5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/brokers/${broker.id}`)}
                            className="flex h-7 items-center gap-1 rounded-[7px] bg-blue-50 px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/20 dark:text-blue-300"
                          >
                            <ExternalLink className="h-3 w-3" /> View
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditDialog(broker)}
                            data-testid={`button-edit-${broker.id}`}
                            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          {isManager && (
                            <button
                              type="button"
                              onClick={() => { if (confirm("Delete this broker?")) deleteBrokerMutation.mutate(broker.id); }}
                              data-testid={`button-delete-${broker.id}`}
                              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-slate-100 text-red-400 hover:bg-red-50 dark:bg-slate-800 dark:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                 <span className="text-[11.5px] text-slate-400">
                   Showing {totalBrokers === 0 ? 0 : (page - 1) * 50 + 1}-{Math.min(page * 50, totalBrokers)} of {totalBrokers} brokers
                 </span>
                <span className="text-[11.5px] text-slate-400">
                   ${brokers.reduce((s, b) => s + (b.creditLimit || 0), 0).toLocaleString()} total credit
                </span>
              </div>
               <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-2.5 dark:border-slate-800">
                 <Button
                   type="button"
                   variant="outline"
                   size="sm"
                   disabled={page <= 1 || isLoading}
                   onClick={() => setPage(currentPage => Math.max(1, currentPage - 1))}
                 >
                   Previous
                 </Button>
                 <Button
                   type="button"
                   variant="outline"
                   size="sm"
                   disabled={page >= totalPages || isLoading}
                   onClick={() => setPage(currentPage => Math.min(totalPages, currentPage + 1))}
                 >
                   Next
                 </Button>
               </div>
            </div>
          )}
        </div>
      </div>
      </main>

      {/* Create/Edit Broker Dialog */}
      <Dialog open={isBrokerDialogOpen} onOpenChange={setIsBrokerDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
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
                        <Input placeholder="ABC Freight Solutions" {...field} />
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
                        <Input placeholder="John Smith" {...field} />
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
                        <Input type="email" placeholder="john@abcfreight.com" {...field} />
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
                        <Input placeholder="(555) 123-4567" {...field} />
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
                      <Input placeholder="123 Main Street" {...field} />
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
                        <Input placeholder="Atlanta" {...field} />
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
                        <Input placeholder="GA" {...field} />
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
                        <Input placeholder="30309" {...field} />
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
                        <Input placeholder="MC123456" {...field} />
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
                        <Input placeholder="123456" {...field} />
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
                        <Input
                          type="number"
                          placeholder="50000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
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
                          <SelectTrigger>
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
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsBrokerDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createBrokerMutation.isPending || updateBrokerMutation.isPending}>
                  {editingBroker ? "Update Broker" : "Create Broker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
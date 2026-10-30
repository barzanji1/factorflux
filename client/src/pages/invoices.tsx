import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FFBadge } from "@/components/ui/ff-badge";
import {
  Plus,
  Search,
  Eye,
  Download,
  FileText,
  ArrowRight,
  ReceiptText,
  Clock3,
  CircleDollarSign,
  Sparkles,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import InvoiceModal from "@/components/modals/invoice-modal";
import CreateInvoiceModal from "@/components/modals/create-invoice-modal";
import type { Invoice } from "@shared/schema";
import { cn } from "@/lib/utils";
import { LOAD_TYPES, LOAD_TYPE_LABELS, type LoadType } from "@shared/load-types";
import { LoadTypeBadge } from "@/components/load-type";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  win95TabsListClassName,
  win95TabsTriggerClassName,
} from "@/components/win95";

type InvoicesResponse = {
  data: Invoice[];
  total: number;
  page: number;
  totalPages: number;
};

export default function Invoices() {
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const agentStatus = (status: string) => ({
    draft: "Draft",
    submitted: "Pending Review",
    docs_pending: "Pending Review",
    under_review: "Pending Review",
    approved: "Approved",
    funded: "Funded",
    paid: "Collected",
    settled: "Settled",
    rejected: "Correction Required",
  }[status] ?? status);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const routeSearch = useSearch();
  const statusFilter = new URLSearchParams(routeSearch).get("status") ?? "";
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loadTypeFilter, setLoadTypeFilter] = useState<"all" | LoadType>("all");
  const [isCreateInvoiceOpen, setIsCreateInvoiceOpen] = useState(false);
  const [isEditInvoiceOpen, setIsEditInvoiceOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const submitMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/invoices/${id}/transition`, { transitionId: "submit", force: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice submitted for funding" });
    },
    onError: (error: Error) => toast({ title: "Unable to submit invoice", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  const { data: invoicesResponse, isLoading: invoicesLoading, isError: invoicesError } = useQuery<InvoicesResponse>({
    queryKey: ["/api/invoices", page, debouncedSearchQuery, loadTypeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        q: debouncedSearchQuery,
        loadType: loadTypeFilter === "all" ? "" : loadTypeFilter,
        status: statusFilter,
      });
      const res = await fetch(`/api/invoices?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load invoices");
      return res.json();
    },
  });

  const invoices = invoicesResponse?.data || [];
  const totalInvoices = invoicesResponse?.total || 0;
  const totalPages = invoicesResponse?.totalPages || 1;
  const invoiceList = invoices;
  const firstInvoice = totalInvoices === 0 ? 0 : (page - 1) * 50 + 1;
  const lastInvoice = totalInvoices === 0 ? 0 : Math.min(page * 50, totalInvoices);

  const handleCreateInvoice = () => {
    setSelectedInvoice(null);
    setIsCreateInvoiceOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsEditInvoiceOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
        return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300";
      case "submitted":
        return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300";
      case "pending":
        return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";
      case "rejected":
        return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300";
      default:
        return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const stats = useMemo(() => {
    const allInvoices = invoices;

    const pendingInvoices = allInvoices.filter(
      (invoice) => (invoice.status as string) === "pending" || invoice.status === "draft"
    ).length;

    const approvedInvoices = allInvoices.filter(
      (invoice) => invoice.status === "approved" || invoice.status === "paid"
    ).length;

    const totalAmount = allInvoices.reduce(
      (sum, invoice) => sum + parseFloat(invoice.amount || "0"),
      0
    );

    return {
      totalInvoices: totalInvoices,
      pendingInvoices,
      approvedInvoices,
      totalAmount,
    };
  }, [invoices, totalInvoices]);

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title={isManager ? "Invoices" : "My invoices"}
          subtitle={isManager ? "Review invoice activity and funding status" : "Create, upload, and submit invoices for funding"}
          group="Workspace"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            <section className="ff-card mb-8 overflow-hidden">
              <div className="flex flex-col gap-6 border-b border-slate-200/70 px-6 py-6 sm:px-7 xl:flex-row xl:items-center xl:justify-between dark:border-slate-800">
                <div className="min-w-0">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                      Invoice workspace
                    </span>
                  </div>

                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    Premium invoice operations
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Create invoices faster, track approvals, and manage billing workflow
                    with a cleaner operational view.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative w-full sm:w-[380px]">
                    {statusFilter && <button type="button" className="mb-2 text-xs underline" onClick={() => { setPage(1); navigate("/invoices"); }}>
                      Status: {statusFilter.replace(/_/g, " ")} · Clear filter
                    </button>}
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search by invoice number or load number..."
                      value={searchQuery}
                       onChange={(e) => {
                         setSearchQuery(e.target.value);
                         setPage(1);
                       }}
                      className="h-10 pl-11 pr-4 text-[13px]"
                    />
                  </div>

                  <Button
                    onClick={handleCreateInvoice}
                    className="h-10 px-4 text-white"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Invoice
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
                <PremiumStatCard
                  title="Total Invoices"
                  value={stats.totalInvoices.toLocaleString()}
                  icon={<ReceiptText className="h-5 w-5" />}
                  tint="blue"
                />

                <PremiumStatCard
                  title="Current page draft / pending"
                  value={stats.pendingInvoices.toLocaleString()}
                  icon={<Clock3 className="h-5 w-5" />}
                  tint="amber"
                />

                <PremiumStatCard
                  title="Current page approved / paid"
                  value={stats.approvedInvoices.toLocaleString()}
                  icon={<FileText className="h-5 w-5" />}
                  tint="emerald"
                />

                <PremiumStatCard
                  title="Current page total amount"
                  value={`$${stats.totalAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}`}
                  icon={<CircleDollarSign className="h-5 w-5" />}
                  tint="violet"
                />
              </div>
            </section>

            <Card className="overflow-hidden">
              <CardHeader className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                 <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center border-2 border-[#808080] bg-[#d4d0c8] text-slate-900">
                        <ReceiptText className="h-4.5 w-4.5" />
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Invoice ledger
                      </span>
                    </div>

                    <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                      All Invoices
                    </CardTitle>

                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Review invoice status, amounts, load references, and action history.
                    </p>
                  </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className={win95TabsListClassName}>
                        {(["all", ...LOAD_TYPES] as const).map((type) => {
                          const active = loadTypeFilter === type;
                          const label = type === "all" ? "All" : LOAD_TYPE_LABELS[type];
                          return (
                            <button
                              key={type}
                              type="button"
                              aria-pressed={active}
                              data-state={active ? "active" : "inactive"}
                              onClick={() => { setLoadTypeFilter(type); setPage(1); }}
                              className={win95TabsTriggerClassName}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                        <span>Showing {firstInvoice}-{lastInvoice} of {totalInvoices} invoices</span>
                      </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {invoicesLoading ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="flex items-center gap-6 px-6 py-6">
                        <div className="h-5 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-5 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-5 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-6 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                        <div className="h-5 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="ml-auto h-8 w-28 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                      </div>
                    ))}
                  </div>
                ) : invoicesError ? (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-red-200 bg-red-50 text-red-500 dark:border-red-900/40 dark:bg-red-950/20">
                      <ReceiptText className="h-7 w-7" />
                    </div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      Failed to load invoices
                    </p>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      Check your connection and try refreshing the page.
                    </p>
                  </div>
                ) : invoiceList.length > 0 ? (
                  <div className="custom-scrollbar overflow-x-auto">
                    <table className="ff-data-table w-full min-w-[940px]">
                      <thead>
                        <tr className="border-b border-slate-200/70 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Invoice #
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                             Carrier
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Amount
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Status
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Load Type
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Submitted
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Actions
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {invoiceList.map((invoice: Invoice) => (
                          <tr
                            key={invoice.id}
                            className="border-b border-slate-100/90 transition-colors hover:bg-slate-50/70 dark:border-slate-800 dark:hover:bg-slate-900/30"
                          >
                            <td className="px-6 py-5">
                              <div className="font-semibold tracking-tight text-slate-900 dark:text-white">
                                {invoice.invoiceNumber}
                              </div>
                            </td>

                            <td className="px-6 py-5 text-sm text-slate-600 dark:text-slate-300">
                              {(invoice as Invoice & { carrierName?: string }).carrierName ?? <span className="text-slate-400">—</span>}
                            </td>

                            <td className="px-6 py-5 text-sm font-semibold text-slate-900 dark:text-white">
                              ${parseFloat(invoice.amount || "0").toFixed(2)}
                            </td>

                            <td className="px-6 py-5">
                              {isManager ? <FFBadge status={invoice.status} /> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{agentStatus(invoice.status)}</span>}
                            </td>

                            <td className="px-6 py-5">
                              <LoadTypeBadge value={invoice.loadType} />
                            </td>

                            <td className="px-6 py-5 text-sm text-slate-500 dark:text-slate-400">
                              {invoice.submittedAt
                                ? new Date(invoice.submittedAt).toLocaleDateString()
                                : "-"}
                            </td>

                            <td className="px-6 py-5">
                              <div className="flex items-center gap-2">
                                <ActionIconButton
                                  title="View Full Detail"
                                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                                  icon={<ChevronRight className="h-4 w-4" />}
                                />

                                 {isManager && <ActionIconButton title="View Invoice" onClick={() => handleEditInvoice(invoice)} icon={<Eye className="h-4 w-4" />} />}

                                <a
                                  href={`/api/invoices/${invoice.id}/download`}
                                  download={`${invoice.invoiceNumber}.pdf`}
                                  title="Download Invoice"
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-[hsl(var(--border))] bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                  <Download className="h-4 w-4" />
                                </a>

                                {!isManager && ["draft", "rejected"].includes(String(invoice.status)) && (
                                  <Button
                                    size="sm"
                                    onClick={() => submitMutation.mutate(invoice.id)}
                                    disabled={submitMutation.isPending}
                                    className="h-8 bg-[#098b9f] px-2.5 text-[11px] text-white hover:bg-[#087b8d]"
                                  >
                                    Submit for Funding
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <ReceiptText className="h-7 w-7" />
                    </div>

                    <p className="text-base font-semibold text-slate-900 dark:text-white">
                      No invoices found
                    </p>

                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                      {searchQuery
                        ? "Try a different invoice number or load number."
                        : "Create your first invoice to start billing operations."}
                    </p>

                    {!searchQuery && (
                      <Button
                        onClick={handleCreateInvoice}
                        className="mt-6 h-10 px-4 text-white"
                      >
                        Create Invoice
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}

                {!invoicesLoading && !invoicesError && (
                  <div className="flex items-center justify-between border-t border-slate-200/70 px-6 py-4 dark:border-slate-800">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Showing {firstInvoice}-{lastInvoice} of {totalInvoices} invoices
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={page <= 1}
                        className="gap-1"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                        disabled={page >= totalPages}
                        className="gap-1"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <InvoiceModal
        isOpen={isEditInvoiceOpen}
        onClose={() => setIsEditInvoiceOpen(false)}
        invoice={selectedInvoice}
      />
      <CreateInvoiceModal open={isCreateInvoiceOpen} onOpenChange={setIsCreateInvoiceOpen} />
    </div>
  );
}

function PremiumStatCard({
  title,
  value,
  icon,
  tint,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  tint: "blue" | "amber" | "emerald" | "violet";
}) {
    const styles = {
    blue: {
      wrap: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
      glow: "",
    },
    amber: {
      wrap: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
      glow: "",
    },
    emerald: {
      wrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
      glow: "",
    },
    violet: {
      wrap: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
      glow: "",
    },
  }[tint];

  return (
    <div className="ff-dashboard-card border p-4">
      <div
        className={cn(
          "mb-3 flex h-9 w-9 items-center justify-center border-2 border-[#808080]",
          styles.wrap,
          styles.glow
        )}
      >
        {icon}
      </div>

      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[#098b9f]">
        {value}
      </p>
    </div>
  );
}

function ActionIconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      title={title}
      className="h-8 w-8 border border-transparent bg-transparent p-0 text-slate-500 transition-colors hover:border-slate-200 hover:bg-white hover:text-slate-700"
    >
      {icon}
    </Button>
  );
}
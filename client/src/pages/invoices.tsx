import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
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
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import InvoiceModal from "@/components/modals/invoice-modal";
import CreateInvoiceModal from "@/components/modals/create-invoice-modal";
import type { Invoice } from "@shared/schema";
import { LOAD_TYPES, LOAD_TYPE_LABELS, type LoadType } from "@shared/load-types";
import { LoadTypeBadge } from "@/components/load-type";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { PageInsights } from "@/components/PageInsights";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
  NeuPageShell,
  NeuStatCard,
  NeuTab,
  NeuTabList,
  NeuTabs,
  NeuTable,
  NeuTableBody,
  NeuTableCell,
  NeuTableHead,
  NeuTableHeader,
  NeuTableRow,
} from "@/styles/neu";

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

  useEffect(() => {
    if (new URLSearchParams(routeSearch).get("create") === "1") setIsCreateInvoiceOpen(true);
  }, [routeSearch]);

  const { data: invoicesResponse, isLoading: invoicesLoading, isError: invoicesError } = useQuery<InvoicesResponse>({
    queryKey: ["/api/invoices", page, debouncedSearchQuery, loadTypeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(DEFAULT_PAGE_SIZE),
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
  const firstInvoice = totalInvoices === 0 ? 0 : (page - 1) * DEFAULT_PAGE_SIZE + 1;
  const lastInvoice = totalInvoices === 0 ? 0 : Math.min(page * DEFAULT_PAGE_SIZE, totalInvoices);

  const handleCreateInvoice = () => {
    setSelectedInvoice(null);
    setIsCreateInvoiceOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsEditInvoiceOpen(true);
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
    <div className="flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title={isManager ? "Invoices" : "My invoices"}
          subtitle={isManager ? "Review invoice activity and funding status" : "Create, upload, and submit invoices for funding"}
          group="Workspace"
          neu
        />

        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1 overflow-auto">
          <PageInsights entity="invoices" title="Invoice portfolio" />
          <div className="mx-auto w-full max-w-[1680px] space-y-6 p-4 sm:p-6 xl:p-8">
            <NeuCard className="mb-8 overflow-hidden rounded-3xl p-5 sm:p-7">
              <div className="flex flex-col gap-6 border-b border-[#c9c9c9] pb-6 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="mb-3 flex items-center gap-2">
                    <NeuBadge tone="accent" className="uppercase tracking-[0.14em]">
                      Invoice workspace
                    </NeuBadge>
                  </div>

                  <h2 className="text-2xl font-semibold tracking-tight text-[#394541]">
                    Premium invoice operations
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7d8883]">
                    Create invoices faster, track approvals, and manage billing workflow
                    with a cleaner operational view.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative w-full sm:w-[380px]">
                    {statusFilter && <button type="button" className="mb-2 block text-xs text-[#168c98] underline underline-offset-4" onClick={() => { setPage(1); navigate("/invoices"); }}>
                      Status: {statusFilter.replace(/_/g, " ")} · Clear filter
                    </button>}
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b9691]" />
                    <NeuInput
                      placeholder="Search by invoice number or load number..."
                      value={searchQuery}
                       onChange={(e) => {
                         setSearchQuery(e.target.value);
                         setPage(1);
                       }}
                      className="h-11 pl-11 pr-4 text-[13px]"
                    />
                  </div>

                  <NeuButton
                    variant="accent"
                    onClick={handleCreateInvoice}
                    className="h-11 px-4"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Invoice
                  </NeuButton>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-6 xl:grid-cols-4">
                <NeuStatCard
                  label="Total Invoices"
                  value={<span className="text-[#27aab8]">{stats.totalInvoices.toLocaleString()}</span>}
                  icon={<ReceiptText className="h-5 w-5" />}
                  className="min-h-32 rounded-2xl p-4 sm:min-h-40 sm:p-5"
                />

                <NeuStatCard
                  label="Current page draft / pending"
                  value={<span className="text-[#27aab8]">{stats.pendingInvoices.toLocaleString()}</span>}
                  icon={<Clock3 className="h-5 w-5" />}
                  className="min-h-32 rounded-2xl p-4 sm:min-h-40 sm:p-5"
                />

                <NeuStatCard
                  label="Current page approved / paid"
                  value={<span className="text-[#27aab8]">{stats.approvedInvoices.toLocaleString()}</span>}
                  icon={<FileText className="h-5 w-5" />}
                  className="min-h-32 rounded-2xl p-4 sm:min-h-40 sm:p-5"
                />

                <NeuStatCard
                  label="Current page total amount"
                  value={<span className="text-[#27aab8]">{`$${stats.totalAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}`}</span>}
                  icon={<CircleDollarSign className="h-5 w-5" />}
                  className="min-h-32 rounded-2xl p-4 sm:min-h-40 sm:p-5"
                />
              </div>
            </NeuCard>

            <NeuCard className="overflow-hidden rounded-3xl">
              <div className="border-b border-[#c9c9c9] px-5 py-5 sm:px-6">
                 <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex items-center gap-2">
                       <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0e0e0] text-[#27aab8] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]">
                         <ReceiptText className="h-4 w-4" />
                      </div>
                       <NeuBadge className="uppercase tracking-[0.14em]">
                        Invoice ledger
                       </NeuBadge>
                    </div>

                     <h2 className="text-xl font-semibold tracking-tight text-[#394541]">
                      All Invoices
                     </h2>

                     <p className="mt-1 text-sm text-[#7d8883]">
                      Review invoice status, amounts, load references, and action history.
                    </p>
                  </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <NeuTabs value={loadTypeFilter} onValueChange={(value) => { setLoadTypeFilter(value as "all" | LoadType); setPage(1); }}>
                        <NeuTabList className="gap-1 rounded-xl p-1">
                        {(["all", ...LOAD_TYPES] as const).map((type) => {
                          const label = type === "all" ? "All" : LOAD_TYPE_LABELS[type];
                          return (
                            <NeuTab
                              key={type}
                              value={type}
                              className="min-h-9 rounded-lg px-3 py-1.5 text-xs"
                            >
                              {label}
                            </NeuTab>
                          );
                        })}
                        </NeuTabList>
                      </NeuTabs>
                      <NeuBadge tone="accent" className="gap-2 py-2">
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                        <span>Showing {firstInvoice}-{lastInvoice} of {totalInvoices} invoices</span>
                      </NeuBadge>
                  </div>
                </div>
              </div>

              <div className="p-0">
                {invoicesLoading ? (
                  <div className="divide-y divide-[#c9c9c9]">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="flex items-center gap-6 px-6 py-6">
                        <div className="h-5 w-32 animate-pulse rounded-lg bg-[#d0d0d0]" />
                        <div className="h-5 w-28 animate-pulse rounded-lg bg-[#d0d0d0]" />
                        <div className="h-5 w-20 animate-pulse rounded-lg bg-[#d0d0d0]" />
                        <div className="h-6 w-24 animate-pulse rounded-full bg-[#d0d0d0]" />
                        <div className="h-5 w-24 animate-pulse rounded-lg bg-[#d0d0d0]" />
                        <div className="ml-auto h-8 w-28 animate-pulse rounded-lg bg-[#d0d0d0]" />
                      </div>
                    ))}
                  </div>
                ) : invoicesError ? (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e0e0e0] text-[#a45f55] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                      <ReceiptText className="h-7 w-7" />
                    </div>
                    <p className="text-base font-semibold text-[#394541]">
                      Failed to load invoices
                    </p>
                    <p className="mt-2 text-sm text-[#7d8883]">
                      Check your connection and try refreshing the page.
                    </p>
                  </div>
                ) : invoiceList.length > 0 ? (
                  <div className="custom-scrollbar overflow-x-auto px-3 py-4 sm:px-5">
                    <NeuTable className="min-w-[940px]">
                      <NeuTableHeader className="bg-[#d7d7d7]/70">
                        <tr className="border-b border-[#c9c9c9]">
                          <NeuTableHead className="px-4 py-3">
                            Invoice #
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                             Carrier
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                            Amount
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                            Status
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                            Load Type
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                            Submitted
                          </NeuTableHead>
                          <NeuTableHead className="px-4 py-3">
                            Actions
                          </NeuTableHead>
                        </tr>
                      </NeuTableHeader>

                      <NeuTableBody>
                        {invoiceList.map((invoice: Invoice) => (
                          <NeuTableRow
                            key={invoice.id}
                          >
                            <NeuTableCell className="px-4 py-4">
                              <div className="font-semibold tracking-tight text-[#394541]">
                                {invoice.invoiceNumber}
                              </div>
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4 text-sm text-[#68746f]">
                              {(invoice as Invoice & { carrierName?: string }).carrierName ?? <span className="text-[#9ba39f]">—</span>}
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4 text-sm font-semibold text-[#394541]">
                              ${parseFloat(invoice.amount || "0").toFixed(2)}
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4">
                              <InvoiceListStatus status={invoice.status} isManager={isManager} agentLabel={agentStatus(invoice.status)} />
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4">
                              <LoadTypeBadge value={invoice.loadType} neuStyle />
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4 text-sm text-[#7d8883]">
                              {invoice.submittedAt
                                ? new Date(invoice.submittedAt).toLocaleDateString()
                                : "-"}
                            </NeuTableCell>

                            <NeuTableCell className="px-4 py-4">
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
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0e0e0] text-[#68746f] shadow-[-4px_-4px_9px_#ffffff,4px_4px_9px_#c1c1c1] transition-[transform,box-shadow,color] hover:text-[#27aab8] active:translate-y-px active:shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
                                >
                                  <Download className="h-4 w-4" />
                                </a>

                                {!isManager && ["draft", "rejected"].includes(String(invoice.status)) && (
                                  <NeuButton
                                    variant="accent"
                                    onClick={() => submitMutation.mutate(invoice.id)}
                                    disabled={submitMutation.isPending}
                                    className="min-h-9 px-2.5 py-1 text-[11px]"
                                  >
                                    Submit for Funding
                                  </NeuButton>
                                )}
                              </div>
                            </NeuTableCell>
                          </NeuTableRow>
                        ))}
                      </NeuTableBody>
                    </NeuTable>
                  </div>
                ) : (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e0e0e0] text-[#7d8883] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                      <ReceiptText className="h-7 w-7" />
                    </div>

                    <p className="text-base font-semibold text-[#394541]">
                      No invoices found
                    </p>

                    <p className="mt-2 text-sm text-[#7d8883]">
                      {searchQuery
                        ? "Try a different invoice number or load number."
                        : "Create your first invoice to start billing operations."}
                    </p>

                    {!searchQuery && (
                      <NeuButton
                        variant="accent"
                        onClick={handleCreateInvoice}
                        className="mt-6 h-11 px-4"
                      >
                        Create Invoice
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </NeuButton>
                    )}
                  </div>
                )}

                {!invoicesLoading && !invoicesError && (
                  <div className="flex flex-col gap-3 border-t border-[#c9c9c9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-sm text-[#7d8883]">
                      Showing {firstInvoice}-{lastInvoice} of {totalInvoices} invoices
                    </p>
                    <div className="flex items-center gap-2">
                      <NeuButton
                        onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                        disabled={page <= 1}
                        className="min-h-9 px-3 py-1.5 text-xs"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </NeuButton>
                      <NeuButton
                        onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                        disabled={page >= totalPages}
                        className="min-h-9 px-3 py-1.5 text-xs"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </NeuButton>
                    </div>
                  </div>
                )}
              </div>
            </NeuCard>
          </div>
        </NeuPageShell>
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

function InvoiceListStatus({ status, isManager, agentLabel }: { status: string; isManager: boolean; agentLabel: string }) {
  const managerLabels: Record<string, string> = {
    draft: "Draft",
    pending: "Pending",
    submitted: "Submitted",
    docs_pending: "Documents Required",
    under_review: "Under Review",
    approved: "Approved",
    paid: "Funded",
    funded: "Funded",
    rejected: "Rejected",
    hold: "On Hold",
    processing: "Processing",
    overdue: "Overdue",
    partial: "Partial",
    active: "Active",
    inactive: "Inactive",
  };
  const label = isManager
    ? managerLabels[status.toLowerCase()] ?? `${status.charAt(0).toUpperCase()}${status.slice(1)}`
    : agentLabel;
  const tone = ["approved", "paid", "funded", "settled"].includes(status) ? "success"
    : ["rejected", "docs_pending", "pending", "held", "hold", "overdue", "partial"].includes(status) ? "warning"
    : ["submitted", "under_review"].includes(status) ? "accent"
    : "neutral";
  return <NeuBadge tone={tone} className={status === "rejected" ? "text-red-700" : undefined}>{label}</NeuBadge>;
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
    <NeuButton
      onClick={onClick}
      title={title}
      className="h-9 w-9 min-h-9 rounded-xl p-0 text-[#68746f]"
    >
      {icon}
    </NeuButton>
  );
}
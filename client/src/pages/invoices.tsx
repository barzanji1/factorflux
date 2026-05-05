import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

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
  Edit,
  FileText,
  ArrowRight,
  ReceiptText,
  Clock3,
  CircleDollarSign,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import InvoiceModal from "@/components/modals/invoice-modal";
import type { Invoice } from "@shared/schema";
import { cn } from "@/lib/utils";

export default function Invoices() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: invoices, isLoading: invoicesLoading, isError: invoicesError } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: searchResults } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices/search", searchQuery],
    enabled: searchQuery.trim().length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/invoices/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
  });

  const displayInvoices = searchQuery.trim() ? searchResults : invoices;
  const invoiceList = displayInvoices || [];

  const handleCreateInvoice = () => {
    setSelectedInvoice(null);
    setIsInvoiceModalOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsInvoiceModalOpen(true);
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
    const allInvoices = invoices || [];

    const totalInvoices = allInvoices.length;
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
      totalInvoices,
      pendingInvoices,
      approvedInvoices,
      totalAmount,
    };
  }, [invoices]);

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.06),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Loads"
          subtitle="Invoice creation, review, status, and processing workflow"
          group="Workspace"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            <section className="mb-8 overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/85 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
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
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search by invoice number or load number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-12 rounded-2xl border-slate-200 bg-white pl-11 pr-4 text-[15px] shadow-sm transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:bg-slate-950"
                    />
                  </div>

                  <Button
                    onClick={handleCreateInvoice}
                    className="h-12 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)] hover:bg-blue-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Invoice
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
                  title="Draft / Pending"
                  value={stats.pendingInvoices.toLocaleString()}
                  icon={<Clock3 className="h-5 w-5" />}
                  tint="amber"
                />

                <PremiumStatCard
                  title="Approved / Paid"
                  value={stats.approvedInvoices.toLocaleString()}
                  icon={<FileText className="h-5 w-5" />}
                  tint="emerald"
                />

                <PremiumStatCard
                  title="Total Amount"
                  value={`$${stats.totalAmount.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}`}
                  icon={<CircleDollarSign className="h-5 w-5" />}
                  tint="violet"
                />
              </div>
            </section>

            <Card className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-200/70 px-6 py-5 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
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

                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                    {searchQuery ? (
                      <span>Showing results for “{searchQuery}”</span>
                    ) : (
                      <span>
                        Showing {invoiceList.length} invoice
                        {invoiceList.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {invoicesLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : invoicesError ? (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-red-200 bg-red-50 text-red-500 shadow-sm dark:border-red-900/40 dark:bg-red-950/20">
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
                    <table className="w-full min-w-[940px]">
                      <thead>
                        <tr className="border-b border-slate-200/70 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Invoice #
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Load #
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Amount
                          </th>
                          <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Status
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
                              {invoice.loadId ? `#${invoice.loadId}` : <span className="text-slate-400">—</span>}
                            </td>

                            <td className="px-6 py-5 text-sm font-semibold text-slate-900 dark:text-white">
                              ${parseFloat(invoice.amount || "0").toFixed(2)}
                            </td>

                            <td className="px-6 py-5">
                              <FFBadge status={invoice.status} />
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

                                <ActionIconButton
                                  title="View Invoice"
                                  onClick={() => handleEditInvoice(invoice)}
                                  icon={<Eye className="h-4 w-4" />}
                                />

                                <ActionIconButton
                                  title="Download Invoice"
                                  onClick={() =>
                                    toast({
                                      title: "Download Started",
                                      description: `Downloading invoice ${invoice.invoiceNumber}`,
                                    })
                                  }
                                  icon={<Download className="h-4 w-4" />}
                                />

                                <ActionIconButton
                                  title="Edit Invoice"
                                  onClick={() => handleEditInvoice(invoice)}
                                  icon={<Edit className="h-4 w-4" />}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] border border-slate-200 bg-slate-50 text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                        className="mt-6 h-11 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700"
                      >
                        Create Invoice
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        invoice={selectedInvoice}
      />
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
      glow: "shadow-[0_8px_20px_rgba(37,99,235,0.14)]",
    },
    amber: {
      wrap: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
      glow: "shadow-[0_8px_20px_rgba(245,158,11,0.14)]",
    },
    emerald: {
      wrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
      glow: "shadow-[0_8px_20px_rgba(16,185,129,0.14)]",
    },
    violet: {
      wrap: "bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400",
      glow: "shadow-[0_8px_20px_rgba(139,92,246,0.14)]",
    },
  }[tint];

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <div
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl",
          styles.wrap,
          styles.glow
        )}
      >
        {icon}
      </div>

      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
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
      className="h-10 w-10 rounded-2xl border border-transparent bg-transparent p-0 text-slate-500 transition-all hover:border-slate-200 hover:bg-white hover:text-slate-700 hover:shadow-sm dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      {icon}
    </Button>
  );
}
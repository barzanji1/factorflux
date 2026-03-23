import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import InvoiceModal from "@/components/modals/invoice-modal";
import type { Invoice } from "@shared/schema";
import { cn } from "@/lib/utils";

export default function Invoices() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: invoices, isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: searchResults } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices/search", { q: searchQuery }],
    enabled: searchQuery.length > 0,
  });

  const displayInvoices = searchQuery ? searchResults : invoices;
  const invoiceList = displayInvoices || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
      case "submitted":
        return "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
      case "pending":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
      case "rejected":
        return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const handleCreateInvoice = () => {
    setSelectedInvoice(null);
    setIsInvoiceModalOpen(true);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsInvoiceModalOpen(true);
  };

  const totalInvoices = invoices?.length || 0;
  const pendingInvoices =
    invoices?.filter((invoice) => invoice.status === "pending").length || 0;
  const approvedInvoices =
    invoices?.filter(
      (invoice) => invoice.status === "approved" || invoice.status === "paid"
    ).length || 0;
  const totalAmount =
    invoices?.reduce((sum, invoice) => sum + parseFloat(invoice.amount || "0"), 0) || 0;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Invoices"
          subtitle="Manage invoice creation, review, status, and processing workflow"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            {/* Top controls */}
            <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by invoice number or load number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 rounded-2xl pl-11 pr-4"
                />
              </div>

              <Button
                onClick={handleCreateInvoice}
                className="h-12 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Invoice
              </Button>
            </section>

            {/* Summary cards */}
            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Invoices</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {totalInvoices}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <Clock3 className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {pendingInvoices}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <FileText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Approved / Paid</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {approvedInvoices}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <CircleDollarSign className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Amount</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  ${totalAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </p>
              </div>
            </section>

            {/* Main table */}
            <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                        <ReceiptText className="h-4.5 w-4.5" />
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Invoice Operations
                      </span>
                    </div>

                    <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                      All Invoices
                    </CardTitle>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Review invoice status, amounts, load references, and actions
                    </p>
                  </div>

                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {searchQuery ? (
                      <>Showing results for “{searchQuery}”</>
                    ) : (
                      <>Showing {invoiceList.length} invoice{invoiceList.length === 1 ? "" : "s"}</>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {invoicesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  </div>
                ) : invoiceList.length > 0 ? (
                  <div className="custom-scrollbar overflow-x-auto">
                    <table className="w-full min-w-[860px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40">
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Invoice #
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Load #
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Amount
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Status
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Submitted
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Actions
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {invoiceList.map((invoice: Invoice) => (
                          <tr
                            key={invoice.id}
                            className="border-b border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/30"
                          >
                            <td className="px-6 py-4">
                              <div className="font-semibold text-blue-700 dark:text-blue-400">
                                {invoice.invoiceNumber}
                              </div>
                            </td>

                            <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
                              #{invoice.loadId}
                            </td>

                            <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">
                              ${parseFloat(invoice.amount).toFixed(2)}
                            </td>

                            <td className="px-6 py-4">
                              <Badge
                                className={cn(
                                  "rounded-full px-2.5 py-1 font-semibold",
                                  getStatusColor(invoice.status)
                                )}
                              >
                                {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                              </Badge>
                            </td>

                            <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                              {invoice.submittedAt
                                ? new Date(invoice.submittedAt).toLocaleDateString()
                                : "-"}
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditInvoice(invoice)}
                                  className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                                  title="View Invoice"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                                  title="Download Invoice"
                                  onClick={() =>
                                    toast({
                                      title: "Download Started",
                                      description: `Downloading invoice ${invoice.invoiceNumber}`,
                                    })
                                  }
                                >
                                  <Download className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditInvoice(invoice)}
                                  className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                                  title="Edit Invoice"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-16 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      <ReceiptText className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      No invoices found
                    </p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {searchQuery
                        ? "Try a different invoice number or load number."
                        : "Create your first invoice to get started."}
                    </p>

                    {!searchQuery && (
                      <Button
                        onClick={handleCreateInvoice}
                        className="mt-5 h-11 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
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
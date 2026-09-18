import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Eye,
  Download,
  Edit,
  ArrowRight,
  ReceiptText,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import InvoiceModal from "@/components/modals/invoice-modal";
import type { Invoice } from "@shared/schema";
import { cn } from "@/lib/utils";

function InvoiceRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-[18px] border border-slate-200/80 p-4 dark:border-slate-800">
      <div className="space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="h-6 w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

function formatCurrency(amount: string | number) {
  return `$${Number(amount).toFixed(2)}`;
}

function formatDate(date?: string | Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

export default function RecentInvoices() {
  const { toast } = useToast();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices", { all: true }],
  });

  const handleViewInvoice = (invoice: Invoice) => {
    toast({
      title: "Invoice Details",
      description: (
        <div className="space-y-1">
          <div>
            <strong>Invoice:</strong> {invoice.invoiceNumber}
          </div>
          <div>
            <strong>Load ID:</strong> {invoice.loadId}
          </div>
          <div>
            <strong>Amount:</strong> {formatCurrency(invoice.amount)}
          </div>
          <div>
            <strong>Status:</strong> {invoice.status.toUpperCase()}
          </div>
          <div>
            <strong>Created:</strong> {formatDate(invoice.createdAt)}
          </div>
        </div>
      ),
      duration: 5000,
    });
  };

  const handleDownloadInvoice = (invoice: Invoice) => {
    toast({
      title: "Download Started",
      description: `Downloading invoice ${invoice.invoiceNumber}`,
    });

    const invoiceData = `
TRUCKING PROS FINANCIAL
Invoice: ${invoice.invoiceNumber}
Load ID: ${invoice.loadId}
Amount: ${formatCurrency(invoice.amount)}
Status: ${invoice.status.toUpperCase()}
Date: ${formatDate(invoice.createdAt)}

Thank you for your business!
    `.trim();

    const blob = new Blob([invoiceData], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `invoice-${invoice.invoiceNumber}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsEditModalOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
        return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300";
      case "submitted":
        return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-300";
      case "pending":
        return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300";
      case "rejected":
        return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300";
      default:
        return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const recentInvoices = invoices.slice(0, 5);

  if (isLoading) {
    return (
      <Card className="ff-dashboard-card rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold text-slate-900 dark:text-white">
              Recent Invoices
            </CardTitle>
            <div className="h-10 w-36 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
          </div>
        </CardHeader>

        <CardContent className="p-5">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <InvoiceRowSkeleton key={index} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="ff-dashboard-card rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <ReceiptText className="h-4.5 w-4.5" />
              </div>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Invoices
              </span>
            </div>

            <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Recent Invoices
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Latest invoice activity across the system
            </p>
          </div>

          <Link href="/invoices">
            <Button
              variant="outline"
              className="h-11 rounded-xl border-slate-200 bg-white px-4 font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              View All Invoices
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {recentInvoices.length > 0 ? (
          <div className="custom-scrollbar overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 dark:bg-slate-900/30 dark:hover:bg-slate-900/30">
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Invoice #
                  </TableHead>
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Load #
                  </TableHead>
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Amount
                  </TableHead>
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Status
                  </TableHead>
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Date
                  </TableHead>
                  <TableHead className="px-6 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {recentInvoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    className="border-slate-100 dark:border-slate-800 dark:hover:bg-slate-900/20"
                  >
                    <TableCell className="px-6">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {invoice.invoiceNumber}
                      </div>
                    </TableCell>

                    <TableCell className="px-6 text-sm text-slate-600 dark:text-slate-300">
                      #{invoice.loadId}
                    </TableCell>

                    <TableCell className="px-6 text-sm font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(invoice.amount)}
                    </TableCell>

                    <TableCell className="px-6">
                      <Badge
                        className={cn(
                          "rounded-full border px-2.5 py-1 font-medium",
                          getStatusColor(invoice.status)
                        )}
                      >
                        {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                      </Badge>
                    </TableCell>

                    <TableCell className="px-6 text-sm text-slate-500 dark:text-slate-400">
                      {formatDate(invoice.createdAt)}
                    </TableCell>

                    <TableCell className="px-6">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => handleViewInvoice(invoice)}
                          title="View Invoice"
                          className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => handleDownloadInvoice(invoice)}
                          title="Download Invoice"
                          className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Download className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => handleEditInvoice(invoice)}
                          title="Edit Invoice"
                          className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <ReceiptText className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              No invoices found
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              New invoices will appear here once created.
            </p>
          </div>
        )}
      </CardContent>

      <InvoiceModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedInvoice(null);
        }}
        invoice={selectedInvoice}
      />
    </Card>
  );
}
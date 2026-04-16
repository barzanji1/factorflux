import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Search,
  Eye,
  Download,
  CreditCard,
  CheckCircle,
  Clock3,
  ReceiptText,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import InvoiceModal from "@/components/modals/invoice-modal";

export default function Factoring() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("payments");
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);

  const openInvoice = (invoice: any) => {
    setSelectedInvoice(invoice);
    setIsInvoiceModalOpen(true);
  };

  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  const pendingPayments = invoices.filter(
    (inv) => inv.status === "submitted" || inv.status === "approved"
  );

  const factoredInvoices = invoices.filter((inv) => inv.status === "paid");

  const todayInvoices = invoices.filter((inv) => {
    const today = new Date().toDateString();
    return inv.submittedAt && new Date(inv.submittedAt).toDateString() === today;
  });

  const totalPendingAmount = pendingPayments.reduce(
    (sum, inv) => sum + parseFloat(inv.amount || 0),
    0
  );

  const totalFactoredAmount = factoredInvoices.reduce(
    (sum, inv) => sum + parseFloat(inv.amount || 0),
    0
  );

  const todayRevenue = todayInvoices.reduce(
    (sum, inv) => sum + parseFloat(inv.amount || 0),
    0
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
      case "approved":
        return "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
      case "submitted":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const filterInvoices = (items: any[]) => {
    return items.filter((invoice) => {
      if (!searchQuery) return true;

      return (
        invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        invoice.loadId?.toString().includes(searchQuery)
      );
    });
  };

  const renderLoading = (colorClass: string) => (
    <div className="flex items-center justify-center py-16">
      <div className={cn("h-10 w-10 animate-spin rounded-full border-2 border-opacity-20 border-t-current", colorClass)} />
    </div>
  );

  const renderEmpty = (
    icon: React.ReactNode,
    title: string,
    description: string
  ) => (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Factoring"
          subtitle="Payment processing, factored invoices, and revenue visibility"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            {/* Summary cards */}
            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <CreditCard className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending Payments</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {formatCurrency(totalPendingAmount)}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {pendingPayments.length} invoices
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <CheckCircle className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Factored Amount</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {formatCurrency(totalFactoredAmount)}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {factoredInvoices.length} invoices
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Today's Revenue</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {formatCurrency(todayRevenue)}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {todayInvoices.length} invoices
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Invoices</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {invoices.length}
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Payment pipeline overview
                </p>
              </div>
            </section>

            {/* Main shell */}
            <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                        <DollarSign className="h-4.5 w-4.5" />
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        Funding Overview
                      </span>
                    </div>

                    <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                      Factoring Dashboard
                    </CardTitle>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Track payments, funded invoices, and same-day revenue performance
                    </p>
                  </div>

                  <div className="relative w-full max-w-md">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search by invoice number or load number..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-12 rounded-2xl pl-11 pr-4"
                      data-testid="input-search-factoring"
                    />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                  <TabsList className="grid h-auto w-full grid-cols-1 gap-2 rounded-[20px] bg-slate-100 p-2 md:grid-cols-3 dark:bg-slate-800">
                    <TabsTrigger
                      value="payments"
                      className="rounded-xl"
                      data-testid="tab-payments"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                        <span>Payments</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger
                      value="factored"
                      className="rounded-xl"
                      data-testid="tab-factored"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        <span>Factored</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger
                      value="revenue"
                      className="rounded-xl"
                      data-testid="tab-revenue"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        <span>Today's Revenue</span>
                      </div>
                    </TabsTrigger>
                  </TabsList>

                  {/* Payments */}
                  <TabsContent value="payments">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-blue-500" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Pending Payments
                        </h3>
                        <Badge variant="outline">{pendingPayments.length} invoices</Badge>
                      </div>

                      {isLoading ? (
                        renderLoading("text-blue-600")
                      ) : filterInvoices(pendingPayments).length > 0 ? (
                        <div className="custom-scrollbar overflow-x-auto rounded-[20px] border border-slate-100 dark:border-slate-800">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                                <TableHead>Invoice #</TableHead>
                                <TableHead>Load #</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Submitted</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filterInvoices(pendingPayments).map((invoice) => (
                                <TableRow key={invoice.id}>
                                  <TableCell className="font-semibold text-blue-700 dark:text-blue-400">
                                    {invoice.invoiceNumber}
                                  </TableCell>
                                  <TableCell>#{invoice.loadId}</TableCell>
                                  <TableCell className="font-semibold">
                                    {formatCurrency(parseFloat(invoice.amount || 0))}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      className={cn(
                                        "rounded-full px-2.5 py-1 font-semibold",
                                        getStatusColor(invoice.status)
                                      )}
                                    >
                                      {invoice.status?.charAt(0).toUpperCase() + invoice.status?.slice(1)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {invoice.submittedAt
                                      ? new Date(invoice.submittedAt).toLocaleDateString()
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="View Invoice" data-testid={`button-view-${invoice.id}`}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="Edit Invoice" data-testid={`button-download-${invoice.id}`}>
                                        <Download className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        renderEmpty(
                          <Clock3 className="h-6 w-6" />,
                          "No pending payments",
                          "Approved and submitted invoices will appear here."
                        )
                      )}
                    </div>
                  </TabsContent>

                  {/* Factored */}
                  <TabsContent value="factored">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-amber-500" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Factored Invoices
                        </h3>
                        <Badge variant="outline">{factoredInvoices.length} invoices</Badge>
                      </div>

                      {isLoading ? (
                        renderLoading("text-amber-600")
                      ) : filterInvoices(factoredInvoices).length > 0 ? (
                        <div className="custom-scrollbar overflow-x-auto rounded-[20px] border border-slate-100 dark:border-slate-800">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                                <TableHead>Invoice #</TableHead>
                                <TableHead>Load #</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Factored Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filterInvoices(factoredInvoices).map((invoice) => (
                                <TableRow key={invoice.id}>
                                  <TableCell className="font-semibold text-amber-700 dark:text-amber-400">
                                    {invoice.invoiceNumber}
                                  </TableCell>
                                  <TableCell>#{invoice.loadId}</TableCell>
                                  <TableCell className="font-semibold">
                                    {formatCurrency(parseFloat(invoice.amount || 0))}
                                  </TableCell>
                                  <TableCell>
                                    {invoice.submittedAt
                                      ? new Date(invoice.submittedAt).toLocaleDateString()
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                      <CheckCircle className="mr-1 h-3 w-3" />
                                      Paid
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="View Invoice" data-testid={`button-view-factored-${invoice.id}`}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="Edit Invoice" data-testid={`button-download-factored-${invoice.id}`}>
                                        <Download className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        renderEmpty(
                          <CheckCircle className="h-6 w-6" />,
                          "No factored invoices",
                          "Paid invoices will appear here once funding is complete."
                        )
                      )}
                    </div>
                  </TabsContent>

                  {/* Revenue */}
                  <TabsContent value="revenue">
                    <div className="space-y-6">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-emerald-500" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Today's Revenue
                        </h3>
                        <Badge variant="outline">{todayInvoices.length} invoices</Badge>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-[20px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/30">
                          <p className="text-sm text-slate-500 dark:text-slate-400">Total Revenue</p>
                          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(todayRevenue)}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/30">
                          <p className="text-sm text-slate-500 dark:text-slate-400">Invoices Count</p>
                          <p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {todayInvoices.length}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/30">
                          <p className="text-sm text-slate-500 dark:text-slate-400">Average Invoice</p>
                          <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                            {todayInvoices.length > 0
                              ? formatCurrency(todayRevenue / todayInvoices.length)
                              : "$0.00"}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/30">
                          <p className="text-sm text-slate-500 dark:text-slate-400">Date</p>
                          <p className="mt-2 text-lg font-bold text-violet-600 dark:text-violet-400">
                            {new Date().toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      {isLoading ? (
                        renderLoading("text-emerald-600")
                      ) : filterInvoices(todayInvoices).length > 0 ? (
                        <div className="custom-scrollbar overflow-x-auto rounded-[20px] border border-slate-100 dark:border-slate-800">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                                <TableHead>Invoice #</TableHead>
                                <TableHead>Load #</TableHead>
                                <TableHead>Amount</TableHead>
                                <TableHead>Time Submitted</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filterInvoices(todayInvoices).map((invoice) => (
                                <TableRow key={invoice.id}>
                                  <TableCell className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    {invoice.invoiceNumber}
                                  </TableCell>
                                  <TableCell>#{invoice.loadId}</TableCell>
                                  <TableCell className="font-semibold">
                                    {formatCurrency(parseFloat(invoice.amount || 0))}
                                  </TableCell>
                                  <TableCell>
                                    {invoice.submittedAt
                                      ? new Date(invoice.submittedAt).toLocaleTimeString()
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      className={cn(
                                        "rounded-full px-2.5 py-1 font-semibold",
                                        getStatusColor(invoice.status)
                                      )}
                                    >
                                      {invoice.status?.charAt(0).toUpperCase() + invoice.status?.slice(1)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="View Invoice" data-testid={`button-view-revenue-${invoice.id}`}>
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={() => openInvoice(invoice)} title="Edit Invoice" data-testid={`button-download-revenue-${invoice.id}`}>
                                        <Download className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        renderEmpty(
                          <Calendar className="h-6 w-6" />,
                          "No revenue recorded today",
                          "Invoices submitted today will appear in this view."
                        )
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => { setIsInvoiceModalOpen(false); setSelectedInvoice(null); }}
        invoice={selectedInvoice}
      />
    </div>
  );
}
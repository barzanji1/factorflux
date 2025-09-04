import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TopNav from "@/components/layout/top-nav";
import { 
  DollarSign, 
  TrendingUp, 
  Calendar,
  Search,
  Eye,
  Download,
  CreditCard,
  CheckCircle,
  Clock
} from "lucide-react";

export default function Factoring() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("payments");

  // Fetch factoring data (using existing invoices for now)
  const { data: invoices = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  // Calculate factoring metrics
  const pendingPayments = invoices.filter(inv => inv.status === "submitted" || inv.status === "approved");
  const factoredInvoices = invoices.filter(inv => inv.status === "paid");
  const todayInvoices = invoices.filter(inv => {
    const today = new Date().toDateString();
    return inv.submittedAt && new Date(inv.submittedAt).toDateString() === today;
  });

  const totalPendingAmount = pendingPayments.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
  const totalFactoredAmount = factoredInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);
  const todayRevenue = todayInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800";
      case "approved":
        return "bg-blue-100 text-blue-800";
      case "submitted":
        return "bg-yellow-100 text-yellow-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav title="Factoring" subtitle="Payment processing and revenue tracking" />
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Factoring</h1>
                <p className="text-gray-600 mt-2">Manage payments, factored invoices, and revenue tracking</p>
              </div>
            </div>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Pending Payments</p>
                  <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalPendingAmount)}</p>
                  <p className="text-sm text-gray-500">{pendingPayments.length} invoices</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Factored Amount</p>
                  <p className="text-2xl font-bold text-orange-600">{formatCurrency(totalFactoredAmount)}</p>
                  <p className="text-sm text-gray-500">{factoredInvoices.length} invoices</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Today's Revenue</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(todayRevenue)}</p>
                  <p className="text-sm text-gray-500">{todayInvoices.length} invoices</p>
                </div>
                <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Factoring Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Factoring Dashboard</CardTitle>
            <CardDescription>Track payments, factored invoices, and revenue performance</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="payments" className="flex items-center space-x-2" data-testid="tab-payments">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <span>Payments</span>
                </TabsTrigger>
                <TabsTrigger value="factored" className="flex items-center space-x-2" data-testid="tab-factored">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span>Factored</span>
                </TabsTrigger>
                <TabsTrigger value="revenue" className="flex items-center space-x-2" data-testid="tab-revenue">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span>Today's Revenue</span>
                </TabsTrigger>
              </TabsList>

              {/* Search */}
              <div className="flex items-center space-x-4 mb-6">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by invoice number, load number, or client..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-factoring"
                  />
                </div>
              </div>

              {/* Payments Tab */}
              <TabsContent value="payments">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                    <h3 className="text-lg font-semibold text-blue-700">Pending Payments</h3>
                    <Badge variant="secondary">{pendingPayments.length} invoices</Badge>
                  </div>
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Load #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingPayments.filter(invoice =>
                          searchQuery === "" ||
                          invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          invoice.loadId?.toString().includes(searchQuery)
                        ).map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium text-blue-600">
                              {invoice.invoiceNumber}
                            </TableCell>
                            <TableCell>#{invoice.loadId}</TableCell>
                            <TableCell className="font-semibold">
                              {formatCurrency(parseFloat(invoice.amount || 0))}
                            </TableCell>
                            <TableCell>
                              <Badge className={getStatusColor(invoice.status)}>
                                {invoice.status?.charAt(0).toUpperCase() + invoice.status?.slice(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {invoice.submittedAt ? new Date(invoice.submittedAt).toLocaleDateString() : "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" data-testid={`button-view-${invoice.id}`}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" data-testid={`button-download-${invoice.id}`}>
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  
                  {pendingPayments.length === 0 && (
                    <div className="text-center py-12">
                      <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No pending payments</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Factored Tab */}
              <TabsContent value="factored">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="w-4 h-4 rounded-full bg-orange-500"></div>
                    <h3 className="text-lg font-semibold text-orange-700">Factored Invoices</h3>
                    <Badge variant="secondary">{factoredInvoices.length} invoices</Badge>
                  </div>
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Load #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Factored Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {factoredInvoices.filter(invoice =>
                          searchQuery === "" ||
                          invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          invoice.loadId?.toString().includes(searchQuery)
                        ).map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium text-orange-600">
                              {invoice.invoiceNumber}
                            </TableCell>
                            <TableCell>#{invoice.loadId}</TableCell>
                            <TableCell className="font-semibold">
                              {formatCurrency(parseFloat(invoice.amount || 0))}
                            </TableCell>
                            <TableCell>
                              {invoice.submittedAt ? new Date(invoice.submittedAt).toLocaleDateString() : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge className="bg-green-100 text-green-800">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Paid
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" data-testid={`button-view-factored-${invoice.id}`}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" data-testid={`button-download-factored-${invoice.id}`}>
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  
                  {factoredInvoices.length === 0 && (
                    <div className="text-center py-12">
                      <CheckCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No factored invoices</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Today's Revenue Tab */}
              <TabsContent value="revenue">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 mb-4">
                    <div className="w-4 h-4 rounded-full bg-green-500"></div>
                    <h3 className="text-lg font-semibold text-green-700">Today's Revenue</h3>
                    <Badge variant="secondary">{todayInvoices.length} invoices</Badge>
                  </div>
                  
                  {/* Revenue Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-full bg-green-500"></div>
                          <div>
                            <p className="text-sm text-gray-600">Total Revenue</p>
                            <p className="text-lg font-bold text-green-600">{formatCurrency(todayRevenue)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <div>
                            <p className="text-sm text-gray-600">Invoices Count</p>
                            <p className="text-lg font-bold text-blue-600">{todayInvoices.length}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                          <div>
                            <p className="text-sm text-gray-600">Average Invoice</p>
                            <p className="text-lg font-bold text-orange-600">
                              {todayInvoices.length > 0 ? formatCurrency(todayRevenue / todayInvoices.length) : "$0.00"}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-4 w-4 text-purple-500" />
                          <div>
                            <p className="text-sm text-gray-600">Date</p>
                            <p className="text-lg font-bold text-purple-600">{new Date().toLocaleDateString()}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Load #</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Time Submitted</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {todayInvoices.filter(invoice =>
                          searchQuery === "" ||
                          invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          invoice.loadId?.toString().includes(searchQuery)
                        ).map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium text-green-600">
                              {invoice.invoiceNumber}
                            </TableCell>
                            <TableCell>#{invoice.loadId}</TableCell>
                            <TableCell className="font-semibold">
                              {formatCurrency(parseFloat(invoice.amount || 0))}
                            </TableCell>
                            <TableCell>
                              {invoice.submittedAt ? new Date(invoice.submittedAt).toLocaleTimeString() : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge className={getStatusColor(invoice.status)}>
                                {invoice.status?.charAt(0).toUpperCase() + invoice.status?.slice(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" data-testid={`button-view-revenue-${invoice.id}`}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" data-testid={`button-download-revenue-${invoice.id}`}>
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  
                  {todayInvoices.length === 0 && (
                    <div className="text-center py-12">
                      <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">No revenue recorded today</p>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
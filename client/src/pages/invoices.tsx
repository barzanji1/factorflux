import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Eye, Download, Edit } from "lucide-react";
import InvoiceModal from "@/components/modals/invoice-modal";
import type { Invoice } from "@shared/schema";

export default function Invoices() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated,
  });

  const { data: searchResults } = useQuery({
    queryKey: ["/api/invoices/search", { q: searchQuery }],
    enabled: searchQuery.length > 0,
  });

  const displayInvoices = searchQuery ? searchResults : invoices;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
        return "bg-green-100 text-green-800";
      case "submitted":
        return "bg-blue-100 text-blue-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "rejected":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Invoices" 
          subtitle="Manage your invoice processing workflow"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by invoice number or load number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-80 pl-10"
                />
              </div>
            </div>
            
            <Button onClick={handleCreateInvoice}>
              <Plus className="w-4 h-4 mr-2" />
              New Invoice
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>All Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              {invoicesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Invoice #</th>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Load #</th>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Amount</th>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Status</th>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Submitted</th>
                        <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {displayInvoices?.map((invoice: Invoice) => (
                        <tr key={invoice.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm font-medium text-primary">
                            {invoice.invoiceNumber}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            #{invoice.loadId}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-secondary">
                            ${parseFloat(invoice.amount).toFixed(2)}
                          </td>
                          <td className="px-6 py-4">
                            <Badge className={getStatusColor(invoice.status)}>
                              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600">
                            {invoice.submittedAt ? new Date(invoice.submittedAt).toLocaleDateString() : "-"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleEditInvoice(invoice)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm">
                                <Download className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleEditInvoice(invoice)}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {displayInvoices?.length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-gray-500">No invoices found</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
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

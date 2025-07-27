import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Download, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import InvoiceModal from "@/components/modals/invoice-modal";
import type { Invoice } from "@shared/schema";

export default function RecentInvoices() {
  const { toast } = useToast();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["/api/invoices"],
  });

  const handleViewInvoice = (invoice: Invoice) => {
    toast({
      title: "Invoice Details",
      description: (
        <div className="space-y-1">
          <div><strong>Invoice:</strong> {invoice.invoiceNumber}</div>
          <div><strong>Load ID:</strong> {invoice.loadId}</div>
          <div><strong>Amount:</strong> ${parseFloat(invoice.amount).toFixed(2)}</div>
          <div><strong>Status:</strong> {invoice.status.toUpperCase()}</div>
          <div><strong>Created:</strong> {new Date(invoice.createdAt!).toLocaleDateString()}</div>
        </div>
      ),
      duration: 5000,
    });
  };

  const handleDownloadInvoice = (invoice: Invoice) => {
    // Generate and download PDF
    toast({
      title: "Download Started",
      description: `Downloading invoice ${invoice.invoiceNumber}`,
    });
    
    // Create a simple text-based invoice for download
    const invoiceData = `
TRUCKING PROS FINANCIAL
Invoice: ${invoice.invoiceNumber}
Load ID: ${invoice.loadId}
Amount: $${parseFloat(invoice.amount).toFixed(2)}
Status: ${invoice.status.toUpperCase()}
Date: ${new Date(invoice.createdAt!).toLocaleDateString()}

Thank you for your business!
    `.trim();
    
    const blob = new Blob([invoiceData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice-${invoice.invoiceNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEditInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsEditModalOpen(true);
    toast({
      title: "Edit Invoice",
      description: `Opening edit form for invoice ${invoice.invoiceNumber}`,
    });
  };

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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Recent Invoices</CardTitle>
            <Button>View All Invoices</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded">
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                    <div className="h-3 bg-gray-200 rounded w-32"></div>
                  </div>
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const recentInvoices = (invoices as Invoice[])?.slice(0, 5) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Recent Invoices</CardTitle>
          <Link href="/invoices">
            <Button>View All Invoices</Button>
          </Link>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Invoice #</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Load #</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Amount</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Status</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Date</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentInvoices.map((invoice: Invoice) => (
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
                    {new Date(invoice.createdAt!).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleViewInvoice(invoice)}
                        title="View Invoice"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleDownloadInvoice(invoice)}
                        title="Download Invoice"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => handleEditInvoice(invoice)}
                        title="Edit Invoice"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {recentInvoices.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">No invoices found</p>
            </div>
          )}
        </div>
      </CardContent>

      {/* Edit Invoice Modal */}
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

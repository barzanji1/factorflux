import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Download, Edit } from "lucide-react";
import type { Invoice } from "@shared/schema";

export default function RecentInvoices() {
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["/api/invoices"],
  });

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

  const recentInvoices = invoices?.slice(0, 5) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Recent Invoices</CardTitle>
          <Button>View All Invoices</Button>
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
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
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
    </Card>
  );
}

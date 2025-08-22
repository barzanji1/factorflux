import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  Eye, 
  Download, 
  Calendar, 
  Upload, 
  Truck, 
  FileCheck,
  DollarSign,
  MapPin,
  Clock,
  Activity
} from "lucide-react";
import type { Document, Invoice, Load } from "@shared/schema";
import DocumentUpload from "@/components/dashboard/document-upload";

export default function Documents() {
  const { toast } = useToast();
  // Authentication system removed
  const [activeTab, setActiveTab] = useState("rate_confirmations");

  const { data: documents = [], isLoading: documentsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: loads = [] } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
  });

  // Filter documents by type
  const rateConfirmations = documents.filter(doc => doc.documentType === 'rate_confirmation');
  const billsOfLading = documents.filter(doc => doc.documentType === 'bill_of_lading');
  const driverDocuments = documents.filter(doc => doc.documentType === 'driver_id' || doc.documentType === 'carrier_setup');
  const otherDocuments = documents.filter(doc => 
    !['rate_confirmation', 'bill_of_lading', 'driver_id', 'carrier_setup'].includes(doc.documentType)
  );

  // Recent activity data
  const recentActivity = [
    { id: 1, type: 'upload', document: 'RC_LOAD_12345.pdf', time: '2 minutes ago', status: 'processed' },
    { id: 2, type: 'upload', document: 'BOL_LOAD_12344.pdf', time: '15 minutes ago', status: 'processing' },
    { id: 3, type: 'view', document: 'DRIVER_ID_JOHN.pdf', time: '1 hour ago', status: 'completed' },
  ];

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case 'rate_confirmation':
        return '📋';
      case 'bill_of_lading':
        return '📄';
      case 'driver_id':
      case 'carrier_setup':
        return '🆔';
      default:
        return '📎';
    }
  };

  const formatDocumentType = (type: string) => {
    switch (type) {
      case 'rate_confirmation':
        return 'Rate Confirmation';
      case 'bill_of_lading':
        return 'Bill of Lading';
      case 'driver_id':
        return 'Driver ID';
      case 'carrier_setup':
        return 'Carrier Setup';
      default:
        return 'Other Document';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processed":
        return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300";
      case "processing":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300";
      case "failed":
        return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300";
    }
  };

  const handleViewDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/view`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } else {
        throw new Error('Failed to view document');
      }
    } catch (error) {
      toast({
        title: "View Error",
        description: "Failed to view document. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/download`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `document_${documentId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        toast({
          title: "Success",
          description: "Document downloaded successfully",
        });
      } else {
        throw new Error('Failed to download document');
      }
    } catch (error) {
      toast({
        title: "Download Error", 
        description: "Failed to download document. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Authentication system removed - always show documents page

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Document Management" 
          subtitle="Manage freight documentation and files"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Invoice Summary Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending Invoices</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {invoices.filter(inv => inv.status === 'submitted').length}
                      </p>
                    </div>
                    <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center">
                      <FileText className="w-6 h-6 text-yellow-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Processed Invoices</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {invoices.filter(inv => inv.status === 'paid').length}
                      </p>
                    </div>
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-green-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Documents</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">{documents.length}</p>
                    </div>
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                      <FileText className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Load Details Section */}
            {loads.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <MapPin className="w-5 h-5 mr-2" />
                    Recent Load Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {loads.slice(0, 3).map((load) => (
                      <div key={load.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">Load #{load.id}</span>
                          <Badge variant="outline">{load.status}</Badge>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {load.pickupLocation} → {load.deliveryLocation}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          {load.pickupDate && new Date(load.pickupDate).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Main Content: Upload Zone with Tabs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Upload Zone */}
              <div className="lg:col-span-2">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="rate_confirmations" className="flex items-center space-x-2">
                      <FileCheck className="w-4 h-4" />
                      <span className="hidden sm:inline">Rate Confirmations</span>
                      <span className="sm:hidden">RC</span>
                    </TabsTrigger>
                    <TabsTrigger value="bills_of_lading" className="flex items-center space-x-2">
                      <FileText className="w-4 h-4" />
                      <span className="hidden sm:inline">Bills of Lading</span>
                      <span className="sm:hidden">BOL</span>
                    </TabsTrigger>
                    <TabsTrigger value="driver_documents" className="flex items-center space-x-2">
                      <Truck className="w-4 h-4" />
                      <span className="hidden sm:inline">Driver Docs</span>
                      <span className="sm:hidden">Driver</span>
                    </TabsTrigger>
                    <TabsTrigger value="other" className="flex items-center space-x-2">
                      <Upload className="w-4 h-4" />
                      <span className="hidden sm:inline">Other</span>
                      <span className="sm:hidden">Other</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="rate_confirmations" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Upload className="w-5 h-5 mr-2" />
                          Upload Rate Confirmation
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DocumentUpload documentType="rate_confirmation" />
                      </CardContent>
                    </Card>
                    
                    {/* Rate Confirmation Documents */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rateConfirmations.map((document) => (
                        <Card key={document.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="text-2xl">{getDocumentIcon(document.documentType)}</div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-sm truncate">{document.originalName}</h3>
                                  <p className="text-xs text-gray-500">{formatFileSize(document.size)}</p>
                                </div>
                              </div>
                              <Badge className={getStatusColor(document.status)}>{document.status}</Badge>
                            </div>
                            
                            {document.loadId && (
                              <p className="text-sm text-gray-600 mb-2">Load #{document.loadId}</p>
                            )}
                            
                            <div className="flex items-center justify-between">
                              <div className="flex items-center text-xs text-gray-500">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span>{new Date(document.createdAt!).toLocaleDateString()}</span>
                              </div>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" onClick={() => handleViewDocument(document.id)}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(document.id)}>
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="bills_of_lading" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Upload className="w-5 h-5 mr-2" />
                          Upload Bill of Lading
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DocumentUpload documentType="bill_of_lading" />
                      </CardContent>
                    </Card>
                    
                    {/* Bills of Lading Documents */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {billsOfLading.map((document) => (
                        <Card key={document.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="text-2xl">{getDocumentIcon(document.documentType)}</div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-sm truncate">{document.originalName}</h3>
                                  <p className="text-xs text-gray-500">{formatFileSize(document.size)}</p>
                                </div>
                              </div>
                              <Badge className={getStatusColor(document.status)}>{document.status}</Badge>
                            </div>
                            
                            {document.loadId && (
                              <p className="text-sm text-gray-600 mb-2">Load #{document.loadId}</p>
                            )}
                            
                            <div className="flex items-center justify-between">
                              <div className="flex items-center text-xs text-gray-500">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span>{new Date(document.createdAt!).toLocaleDateString()}</span>
                              </div>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" onClick={() => handleViewDocument(document.id)}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(document.id)}>
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="driver_documents" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Upload className="w-5 h-5 mr-2" />
                          Upload Driver Documents
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DocumentUpload documentType="driver_id" />
                      </CardContent>
                    </Card>
                    
                    {/* Driver Documents */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {driverDocuments.map((document) => (
                        <Card key={document.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="text-2xl">{getDocumentIcon(document.documentType)}</div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-sm truncate">{document.originalName}</h3>
                                  <p className="text-xs text-gray-500">{formatFileSize(document.size)}</p>
                                </div>
                              </div>
                              <Badge className={getStatusColor(document.status)}>{document.status}</Badge>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <div className="flex items-center text-xs text-gray-500">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span>{new Date(document.createdAt!).toLocaleDateString()}</span>
                              </div>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" onClick={() => handleViewDocument(document.id)}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(document.id)}>
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="other" className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <Upload className="w-5 h-5 mr-2" />
                          Upload Other Documents
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DocumentUpload documentType="other" />
                      </CardContent>
                    </Card>
                    
                    {/* Other Documents */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {otherDocuments.map((document) => (
                        <Card key={document.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center space-x-3">
                                <div className="text-2xl">{getDocumentIcon(document.documentType)}</div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-medium text-sm truncate">{document.originalName}</h3>
                                  <p className="text-xs text-gray-500">{formatFileSize(document.size)}</p>
                                </div>
                              </div>
                              <Badge className={getStatusColor(document.status)}>{document.status}</Badge>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <div className="flex items-center text-xs text-gray-500">
                                <Calendar className="w-3 h-3 mr-1" />
                                <span>{new Date(document.createdAt!).toLocaleDateString()}</span>
                              </div>
                              <div className="flex space-x-2">
                                <Button variant="ghost" size="sm" onClick={() => handleViewDocument(document.id)}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDownloadDocument(document.id)}>
                                  <Download className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Recent Activity / Payment Status */}
              <div className="space-y-6">
                {/* Recent Activity */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Activity className="w-5 h-5 mr-2" />
                      Recent Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {recentActivity.map((activity) => (
                        <div key={activity.id} className="flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                            <FileText className="w-4 h-4 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{activity.document}</p>
                            <p className="text-xs text-gray-500">{activity.time}</p>
                          </div>
                          <Badge variant="outline" className={getStatusColor(activity.status)}>
                            {activity.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Payment Status */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <DollarSign className="w-5 h-5 mr-2" />
                      Payment Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Recent Payment</p>
                          <p className="text-xs text-gray-500">Load #12345</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-600">$2,450</p>
                          <p className="text-xs text-gray-500">2 days ago</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Pending Payment</p>
                          <p className="text-xs text-gray-500">Load #12346</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-yellow-600">$1,850</p>
                          <p className="text-xs text-gray-500">Processing</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
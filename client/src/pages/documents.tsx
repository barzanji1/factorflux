import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, FilePlus, Eye, Download, Calendar, Upload, Truck, FileCheck } from "lucide-react";
import type { Document } from "@shared/schema";
import DocumentUpload from "@/components/dashboard/document-upload";

export default function Documents() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("rate_confirmations");

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

  const { data: documents = [], isLoading: documentsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
    enabled: isAuthenticated,
  });

  // Filter documents by type
  const rateConfirmations = documents.filter(doc => doc.documentType === 'rate_confirmation');
  const billsOfLading = documents.filter(doc => doc.documentType === 'bill_of_lading');
  const driverDocuments = documents.filter(doc => doc.documentType === 'driver_id' || doc.documentType === 'carrier_setup');
  const otherDocuments = documents.filter(doc => 
    !['rate_confirmation', 'bill_of_lading', 'driver_id', 'carrier_setup'].includes(doc.documentType)
  );

  const getDocumentIcon = (documentType: string) => {
    switch (documentType) {
      case "rate_confirmation":
        return "📄";
      case "bill_of_lading":
        return "📋";
      case "driver_id":
        return "🪪";
      case "carrier_setup":
        return "📝";
      default:
        return "📄";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processed":
        return "bg-green-100 text-green-800";
      case "processing":
        return "bg-yellow-100 text-yellow-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDocumentType = (type: string) => {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  const handleViewDocument = (documentId: number) => {
    window.open(`/api/documents/${documentId}/view`, '_blank');
  };

  const handleDownloadDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/download`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `document-${documentId}`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Error",
        description: "Failed to download document. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Render document grid for each tab
  const renderDocumentGrid = (docs: Document[], loading: boolean, emptyMessage: string) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      );
    }

    if (docs.length === 0) {
      return (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              No {emptyMessage} uploaded
            </h3>
            <p className="text-gray-500 dark:text-gray-400">
              Upload your first {emptyMessage.replace(/s$/, '')} to get started
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {docs.map((document: Document) => (
          <Card key={document.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">
                    {getDocumentIcon(document.documentType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-secondary truncate">
                      {document.originalName}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {formatDocumentType(document.documentType)}
                    </p>
                  </div>
                </div>
                <Badge className={getStatusColor(document.status)}>
                  {document.status}
                </Badge>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Size:</span>
                <span className="text-secondary">{formatFileSize(document.size)}</span>
              </div>
              
              {document.loadId && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Load #:</span>
                  <span className="text-secondary">{document.loadId}</span>
                </div>
              )}
              
              <div className="flex items-center text-xs text-gray-500">
                <Calendar className="w-3 h-3 mr-1" />
                <span>
                  Uploaded {new Date(document.createdAt!).toLocaleDateString()}
                </span>
              </div>
              
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex space-x-2">
                  <button 
                    onClick={() => handleViewDocument(document.id)}
                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title="View document"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDownloadDocument(document.id)}
                    className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                    title="Download document"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Documents" 
          subtitle="Manage uploaded documents and files"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="rate_confirmations" className="flex items-center space-x-2">
                <FileCheck className="w-4 h-4" />
                <span>Rate Confirmations</span>
              </TabsTrigger>
              <TabsTrigger value="bills_of_lading" className="flex items-center space-x-2">
                <FileText className="w-4 h-4" />
                <span>Bills of Lading</span>
              </TabsTrigger>
              <TabsTrigger value="driver_documents" className="flex items-center space-x-2">
                <Truck className="w-4 h-4" />
                <span>Driver Documents</span>
              </TabsTrigger>
              <TabsTrigger value="other" className="flex items-center space-x-2">
                <FilePlus className="w-4 h-4" />
                <span>Other Documents</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rate_confirmations" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
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
                </div>
                <div className="lg:col-span-2">
                  {renderDocumentGrid(rateConfirmations, documentsLoading, "rate confirmations")}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="bills_of_lading" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
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
                </div>
                <div className="lg:col-span-2">
                  {renderDocumentGrid(billsOfLading, documentsLoading, "bills of lading")}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="driver_documents" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
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
                </div>
                <div className="lg:col-span-2">
                  {renderDocumentGrid(driverDocuments, documentsLoading, "driver documents")}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="other" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
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
                </div>
                <div className="lg:col-span-2">
                  {renderDocumentGrid(otherDocuments, documentsLoading, "other documents")}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

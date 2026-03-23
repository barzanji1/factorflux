import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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
  Activity,
  ReceiptText,
  FolderOpen,
  Clock3,
  ArrowUpRight,
} from "lucide-react";
import type { Document, Invoice, Load } from "@shared/schema";
import DocumentUpload from "@/components/dashboard/document-upload";
import { cn } from "@/lib/utils";

export default function Documents() {
  const { toast } = useToast();
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

  const rateConfirmations = documents.filter(
    (doc) => doc.documentType === "rate_confirmation"
  );
  const billsOfLading = documents.filter(
    (doc) => doc.documentType === "bill_of_lading"
  );
  const driverDocuments = documents.filter(
    (doc) => doc.documentType === "driver_id" || doc.documentType === "carrier_setup"
  );
  const otherDocuments = documents.filter(
    (doc) =>
      !["rate_confirmation", "bill_of_lading", "driver_id", "carrier_setup"].includes(
        doc.documentType
      )
  );

  const recentActivity = [
    {
      id: 1,
      type: "upload",
      document: "RC_LOAD_12345.pdf",
      time: "2 minutes ago",
      status: "processed",
    },
    {
      id: 2,
      type: "upload",
      document: "BOL_LOAD_12344.pdf",
      time: "15 minutes ago",
      status: "processing",
    },
    {
      id: 3,
      type: "view",
      document: "DRIVER_ID_JOHN.pdf",
      time: "1 hour ago",
      status: "completed",
    },
  ];

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case "rate_confirmation":
        return <FileCheck className="h-5 w-5" />;
      case "bill_of_lading":
        return <ReceiptText className="h-5 w-5" />;
      case "driver_id":
      case "carrier_setup":
        return <Truck className="h-5 w-5" />;
      default:
        return <FolderOpen className="h-5 w-5" />;
    }
  };

  const formatDocumentType = (type: string) => {
    switch (type) {
      case "rate_confirmation":
        return "Rate Confirmation";
      case "bill_of_lading":
        return "Bill of Lading";
      case "driver_id":
        return "Driver ID";
      case "carrier_setup":
        return "Carrier Setup";
      default:
        return "Other Document";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processed":
      case "completed":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
      case "processing":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
      case "failed":
        return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const handleViewDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/view`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to view document");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch {
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
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to download document");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
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
    } catch {
      toast({
        title: "Download Error",
        description: "Failed to download document. Please try again.",
        variant: "destructive",
      });
    }
  };

  const renderDocumentGrid = (docs: Document[]) => {
    if (documentsLoading) {
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/30"
            >
              <div className="animate-pulse space-y-3">
                <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-8 w-full rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (docs.length === 0) {
      return (
        <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900/30">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <FolderOpen className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            No documents in this category
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Upload files to populate this section.
          </p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {docs.map((document) => (
          <Card
            key={document.id}
            className="group rounded-[22px] border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-blue-100 hover:shadow-[0_16px_40px_rgba(37,99,235,0.10)] dark:border-slate-800 dark:bg-transparent dark:hover:border-blue-950/40"
          >
            <CardContent className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                    {getDocumentIcon(document.documentType)}
                  </div>

                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {document.originalName}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatDocumentType(document.documentType)} • {formatFileSize(document.size)}
                    </p>
                  </div>
                </div>

                <Badge
                  className={cn(
                    "rounded-full px-2.5 py-1 font-semibold",
                    getStatusColor(document.status)
                  )}
                >
                  {document.status}
                </Badge>
              </div>

              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {document.loadId && (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-slate-400" />
                    <span>Load #{document.loadId}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span>{new Date(document.createdAt!).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  File ready for review
                </span>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewDocument(document.id)}
                    className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                    title="View Document"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownloadDocument(document.id)}
                    className="h-9 w-9 rounded-xl border border-transparent p-0 text-slate-500 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                    title="Download Document"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Document Management"
          subtitle="Manage freight documentation, uploads, and supporting files"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            {/* Summary */}
            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <Clock3 className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending Invoices</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {invoices.filter((inv) => inv.status === "submitted").length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <DollarSign className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Processed Invoices</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {invoices.filter((inv) => inv.status === "paid").length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <FileText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Documents</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {documents.length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <Truck className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Tracked Loads</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {loads.length}
                </p>
              </div>
            </section>

            {/* Loads */}
            {loads.length > 0 && (
              <section className="mb-8">
                <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                        <MapPin className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          Recent Load Details
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Quick reference for the most recent tracked loads
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {loads.slice(0, 3).map((load) => (
                        <div
                          key={load.id}
                          className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/30"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              Load #{load.id}
                            </span>
                            <Badge
                              className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            >
                              {load.status}
                            </Badge>
                          </div>

                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            {load.pickupLocation} → {load.deliveryLocation}
                          </p>

                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {load.pickupDate
                              ? new Date(load.pickupDate).toLocaleDateString()
                              : "No pickup date"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Main grid */}
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              {/* Left */}
              <div className="xl:col-span-8">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-[20px] bg-slate-100 p-2 md:grid-cols-4 dark:bg-slate-800">
                    <TabsTrigger value="rate_confirmations" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <FileCheck className="h-4 w-4" />
                        <span className="hidden sm:inline">Rate Confirmations</span>
                        <span className="sm:hidden">RC</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="bills_of_lading" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <ReceiptText className="h-4 w-4" />
                        <span className="hidden sm:inline">Bills of Lading</span>
                        <span className="sm:hidden">BOL</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="driver_documents" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        <span className="hidden sm:inline">Driver Docs</span>
                        <span className="sm:hidden">Driver</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="other" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        <span>Other</span>
                      </div>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="rate_confirmations" className="space-y-6">
                    <DocumentUpload documentType="rate_confirmation" />
                    {renderDocumentGrid(rateConfirmations)}
                  </TabsContent>

                  <TabsContent value="bills_of_lading" className="space-y-6">
                    <DocumentUpload documentType="bill_of_lading" />
                    {renderDocumentGrid(billsOfLading)}
                  </TabsContent>

                  <TabsContent value="driver_documents" className="space-y-6">
                    <DocumentUpload documentType="driver_id" />
                    {renderDocumentGrid(driverDocuments)}
                  </TabsContent>

                  <TabsContent value="other" className="space-y-6">
                    <DocumentUpload documentType="other" />
                    {renderDocumentGrid(otherDocuments)}
                  </TabsContent>
                </Tabs>
              </div>

              {/* Right */}
              <div className="space-y-6 xl:col-span-4">
                <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                        <Activity className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          Recent Activity
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Latest document workflow events
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 p-6">
                    {recentActivity.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/30"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                          <FileText className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                            {activity.document}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {activity.time}
                          </p>
                        </div>

                        <Badge
                          className={cn(
                            "rounded-full px-2.5 py-1 font-semibold",
                            getStatusColor(activity.status)
                          )}
                        >
                          {activity.status}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                        <DollarSign className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          Payment Status
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Quick funding visibility
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 p-6">
                    <div className="rounded-[20px] border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-slate-950/30">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            Recent Payment
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Load #12345
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                            $2,450
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            2 days ago
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 dark:border-amber-900/40 dark:from-amber-950/20 dark:to-slate-950/30">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            Pending Payment
                          </p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Load #12346
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
                            $1,850
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Processing
                          </p>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      className="h-11 w-full rounded-xl"
                      onClick={() =>
                        toast({
                          title: "Payment Overview",
                          description: "Opening payment details soon.",
                        })
                      }
                    >
                      Open Payment Overview
                      <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
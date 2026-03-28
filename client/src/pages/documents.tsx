import { useQuery } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Eye,
  Download,
  Calendar,
  Truck,
  FileCheck,
  DollarSign,
  MapPin,
  Activity,
  ReceiptText,
  FolderOpen,
  Clock3,
  ArrowUpRight,
  FileText,
} from "lucide-react";
import type { Document, Invoice, Load } from "@shared/schema";
import { cn } from "@/lib/utils";

export default function Documents() {
  const { toast } = useToast();

  const { data: documents = [], isLoading: documentsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: loads = [] } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
  });

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
      case "lumper_receipt":
        return <ReceiptText className="h-5 w-5" />;
      case "fuel_receipt":
        return <DollarSign className="h-5 w-5" />;
      case "driver_docs":
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
      case "lumper_receipt":
        return "Lumper Receipt";
      case "fuel_receipt":
        return "Fuel Receipt";
      case "driver_docs":
        return "Carrier / Driver Docs";
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
        return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300";
      case "processing":
        return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300";
      case "failed":
        return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300";
      default:
        return "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
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
      a.download = `document_${documentId}`;
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

  const sectionDocuments = (sectionKey: string) => {
    switch (sectionKey) {
      case "rate_confirmation":
        return documents.filter((doc) => doc.documentType === "rate_confirmation");
      case "bill_of_lading":
        return documents.filter((doc) => doc.documentType === "bill_of_lading");
      case "lumper_receipt":
        return documents.filter((doc) => doc.documentType === "lumper_receipt");
      case "fuel_receipt":
        return documents.filter((doc) => doc.documentType === "fuel_receipt");
      case "driver_docs":
        return documents.filter(
          (doc) =>
            doc.documentType === "driver_docs" ||
            doc.documentType === "driver_id" ||
            doc.documentType === "carrier_setup"
        );
      case "other_docs":
        return documents.filter((doc) => doc.documentType === "other");
      default:
        return [];
    }
  };

  const renderDocumentGrid = (docs: Document[], title: string) => {
    if (documentsLoading) {
      return (
        <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
          <CardHeader className="border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 gap-4">
              {[...Array(2)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/30"
                >
                  <div className="animate-pulse space-y-3">
                    <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-8 w-full rounded bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold text-slate-900 dark:text-white">
              {title}
            </CardTitle>
            <Badge className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {docs.length}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5">
          {docs.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-900/30">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <FolderOpen className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                No documents yet
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Upload files to populate this category.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {docs.map((document) => (
                <Card
                  key={document.id}
                  className="rounded-[18px] border border-slate-200/80 bg-white shadow-sm transition dark:border-slate-800 dark:bg-transparent"
                >
                  <CardContent className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                          "rounded-full border px-2.5 py-1 font-medium",
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
                        Ready for review
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
          )}
        </CardContent>
      </Card>
    );
  };

  const recentUploads = documents
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    )
    .slice(0, 5);

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Document Management"
          subtitle="Manage freight paperwork, uploads, and supporting files"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Clock3 className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Pending Invoices</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {invoices.filter((inv) => inv.status === "submitted").length}
                </p>
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <DollarSign className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Processed Invoices</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {invoices.filter((inv) => inv.status === "paid").length}
                </p>
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <FileText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Documents</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {documents.length}
                </p>
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <Truck className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Tracked Loads</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {loads.length}
                </p>
              </div>
            </section>

            {loads.length > 0 && (
              <section className="mb-8">
                <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <MapPin className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          Recent Load Details
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Quick reference for recently tracked loads
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {loads.slice(0, 3).map((load) => (
                        <div
                          key={load.id}
                          className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/30"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              Load #{load.id}
                            </span>
                            <Badge className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
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

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              <div className="space-y-6 xl:col-span-8">
                <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Supporting Documents
                        </h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Upload rate confirmations, BOLs, lumpers, and receipts during invoice creation.
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        className="h-11 rounded-xl px-5"
                        onClick={() =>
                          toast({
                            title: "Create Invoice",
                            description: "Open the Create Invoice modal to upload supporting documents.",
                          })
                        }
                      >
                        Create Invoice
                        <ArrowUpRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  {renderDocumentGrid(sectionDocuments("rate_confirmation"), "Rate Confirmations")}
                  {renderDocumentGrid(sectionDocuments("bill_of_lading"), "Bills of Lading")}
                  {renderDocumentGrid(sectionDocuments("lumper_receipt"), "Lumper Receipts")}
                  {renderDocumentGrid(sectionDocuments("fuel_receipt"), "Fuel Receipts")}
                  {renderDocumentGrid(sectionDocuments("driver_docs"), "Carrier / Driver Docs")}
                  {renderDocumentGrid(sectionDocuments("other_docs"), "Other Documents")}
                </div>
              </div>

              <div className="space-y-6 xl:col-span-4">
                <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Activity className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
                          Recent Uploads
                        </CardTitle>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          Latest document activity
                        </p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3 p-6">
                    {recentUploads.length > 0 ? (
                      recentUploads.map((document) => (
                        <div
                          key={document.id}
                          className="flex items-center gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/30"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {getDocumentIcon(document.documentType)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                              {document.originalName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {new Date(document.createdAt!).toLocaleString()}
                            </p>
                          </div>

                          <Badge
                            className={cn(
                              "rounded-full border px-2.5 py-1 font-medium",
                              getStatusColor(document.status)
                            )}
                          >
                            {document.status}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-slate-200 px-6 py-10 text-center dark:border-slate-800">
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No recent uploads yet
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
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
                    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/30">
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
                          <p className="text-xl font-semibold text-slate-900 dark:text-white">
                            $2,450
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            2 days ago
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/30">
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
                          <p className="text-xl font-semibold text-slate-900 dark:text-white">
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
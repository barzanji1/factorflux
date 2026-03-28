import { useState, useCallback, useId, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CloudUpload,
  FileIcon,
  ShieldCheck,
  FileCheck2,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentUploadProps {
  onUploadComplete?: () => void;
  documentType?: string;
}

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
];

export default function DocumentUpload({
  onUploadComplete,
  documentType = "other",
}: DocumentUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      formData.append("documentType", documentType);
      const response = await apiRequest("POST", "/api/documents/upload", formData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });

      onUploadComplete?.();
    },
    onError: (error: Error) => {
      let errorMessage = "Failed to upload document";

      if (error.message.includes("401") || error.message.includes("Authentication required")) {
        errorMessage = "Please log in again to upload documents";
        setTimeout(() => {
          window.location.href = "/login";
        }, 2000);
      } else if (error.message.includes("413") || error.message.includes("too large")) {
        errorMessage = "File is too large. Maximum size is 10MB";
      } else if (error.message.includes("Only PDF, JPEG, JPG, and PNG")) {
        errorMessage = "Only PDF, JPEG, JPG, and PNG files are allowed";
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const openFilePicker = () => {
    inputRef.current?.click();
  };

  const validateFiles = (files: File[]) => {
    const validFiles: File[] = [];

    files.forEach((file) => {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: `${file.name} is not a supported file. Use PDF, JPG, or PNG.`,
          variant: "destructive",
        });
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast({
          title: "File too large",
          description: `${file.name} exceeds the 10MB size limit.`,
          variant: "destructive",
        });
        return;
      }

      validFiles.push(file);
    });

    return validFiles;
  };

  const handleFiles = useCallback(
    (files: File[]) => {
      const validFiles = validateFiles(files);

      validFiles.forEach((file) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("documentType", documentType);
        uploadMutation.mutate(formData);
      });
    },
    [documentType, uploadMutation]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      handleFiles(files);
    },
    [handleFiles]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    handleFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const getDocumentTypeLabel = (type: string) => {
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
        return "Documents";
    }
  };

  const getDocumentDescription = (type: string) => {
    switch (type) {
      case "rate_confirmation":
        return "Upload rate confirmation documents for this load";
      case "bill_of_lading":
        return "Upload bill of lading documents for this load";
      case "driver_id":
        return "Upload driver ID and carrier setup documents";
      default:
        return "All supporting documents such as RC, BOL, lumpers, and receipts";
    }
  };

  return (
    <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 pb-5 dark:border-slate-800">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <FileCheck2 className="h-4.5 w-4.5" />
              </div>

              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Document Intake
              </span>
            </div>

            <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Upload {getDocumentTypeLabel(documentType)}
            </CardTitle>

            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {getDocumentDescription(documentType)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                uploadMutation.isPending
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  uploadMutation.isPending ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              {uploadMutation.isPending ? "Uploading" : "Ready"}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={openFilePicker}
              disabled={uploadMutation.isPending}
              className="h-10 rounded-xl border-slate-200 px-4 dark:border-slate-700"
            >
              <FileIcon className="mr-2 h-4 w-4" />
              Choose Files
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload ${getDocumentTypeLabel(documentType)}`}
          className={cn(
            "relative cursor-pointer rounded-[22px] border border-dashed p-10 text-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2",
            isDragOver
              ? "border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/10"
              : "border-slate-300 bg-slate-50/70 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-slate-600"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openFilePicker();
            }
          }}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[18px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <CloudUpload className="h-7 w-7" />
          </div>

          <h4 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Drop files here
          </h4>

          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Or click to browse from your computer
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              PDF
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              JPG
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              PNG
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Max 10MB
            </span>
          </div>

          <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
            JPEG images are automatically converted to PDF for storage and review.
          </p>
        </div>

        {uploadMutation.isPending && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700 dark:border-slate-700 dark:border-t-slate-200" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Uploading documents
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Processing your files securely
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Clean readable scans
            </h4>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Make sure documents are clear, flat, and easy to read before upload.
            </p>
          </div>

          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <FileCheck2 className="h-4.5 w-4.5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Smart processing
            </h4>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              JPEG images are automatically converted to PDF for easier storage and review.
            </p>
          </div>

          <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <ArrowUpRight className="h-4.5 w-4.5" />
            </div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Faster indexing
            </h4>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Include load numbers in file names when possible to improve tracking.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
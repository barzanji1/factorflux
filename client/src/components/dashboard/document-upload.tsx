import { useState, useCallback, useId, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CloudUpload,
  FileIcon,
  FileCheck2,
  ReceiptText,
  Fuel,
  Truck,
  FolderOpen,
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
          description: `${file.name} is not supported. Use PDF, JPG, or PNG.`,
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

  const getDocumentMeta = (type: string) => {
    switch (type) {
      case "rate_confirmation":
        return {
          label: "Rate Confirmation",
          description: "Signed rate confirmations.",
          icon: <FileCheck2 className="h-4 w-4" />,
        };
      case "bill_of_lading":
        return {
          label: "Bill of Lading",
          description: "Delivered BOL and POD files.",
          icon: <ReceiptText className="h-4 w-4" />,
        };
      case "lumper_receipt":
        return {
          label: "Lumper Receipt",
          description: "Lumper and unloading receipts.",
          icon: <ReceiptText className="h-4 w-4" />,
        };
      case "fuel_receipt":
        return {
          label: "Fuel Receipt",
          description: "Fuel, toll, scale, and reimbursement receipts.",
          icon: <Fuel className="h-4 w-4" />,
        };
      case "driver_docs":
      case "driver_id":
      case "carrier_setup":
        return {
          label: "Carrier / Driver Docs",
          description: "Driver ID and onboarding docs.",
          icon: <Truck className="h-4 w-4" />,
        };
      default:
        return {
          label: "Other Documents",
          description: "Additional supporting paperwork.",
          icon: <FolderOpen className="h-4 w-4" />,
        };
    }
  };

  const meta = getDocumentMeta(documentType);

  return (
    <Card className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {meta.icon}
            </div>

            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-slate-900 dark:text-white">
                {meta.label}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {meta.description}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={openFilePicker}
            disabled={uploadMutation.isPending}
            className="h-9 rounded-xl border-slate-200 px-3 dark:border-slate-700"
          >
            <FileIcon className="mr-2 h-4 w-4" />
            Select
          </Button>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload ${meta.label}`}
          className={cn(
            "relative cursor-pointer rounded-[18px] border-2 border-dashed p-5 text-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2",
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

          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-300">
            <CloudUpload className="h-5 w-5" />
          </div>

          <h4 className="text-base font-semibold text-slate-900 dark:text-white">
            Drop files here
          </h4>

          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            or click to browse
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              PDF
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              JPG
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              PNG
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              10MB max
            </span>
          </div>
        </div>

        {uploadMutation.isPending && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600 dark:border-amber-900/40 dark:border-t-amber-300" />
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Uploading...
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
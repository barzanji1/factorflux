import { useRef, useState, useCallback, type ComponentProps } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { Button as ButtonPrimitive } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Zap,
  AlertTriangle,
  Tag,
  ClipboardCheck,
} from "lucide-react";
import ExtractionResultPanel from "./extraction-result-panel";
import DocumentReviewDialog from "./document-review-dialog";
import { useSafeDrop } from "@/hooks/use-safe-drop";
import { NeuBadge, NeuButton, NeuCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";

export type IntakeEntityType = "invoice" | "load" | "client" | "broker";

interface Props {
  entityType: IntakeEntityType;
  entityId: number;
  onUploadComplete?: (doc: any) => void;
  compact?: boolean;
  neuStyle?: boolean;
}

function IntakeAction({ neuStyle, ...props }: ComponentProps<typeof ButtonPrimitive> & { neuStyle?: boolean }) {
  if (!neuStyle) return <ButtonPrimitive {...props} />;
  const { variant, size, className, asChild: _asChild, ...buttonProps } = props;
  return (
    <NeuButton
      {...buttonProps}
      className={cn(
        "min-h-9 px-3 py-1.5 text-xs",
        size === "sm" && "min-h-8 px-3 py-1",
        size === "icon" && "min-h-8 w-8 p-1",
        variant === "ghost" && "bg-transparent shadow-none",
        variant === "destructive" && "bg-[#b84b45] text-white",
        className,
      )}
    />
  );
}

interface UploadedFile {
  localId: string;
  name: string;
  size: number;
  mimeType: string;
  progress: number;
  documentId: number | null;
  status: "uploading" | "queued" | "processing" | "completed" | "failed";
  error?: string;
  expanded: boolean;
  candidateDocumentType?: string | null;
  finalDocumentType?: string | null;
}

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/tiff",
  "image/heic", "image/heif", "application/msword", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const MAX_SIZE      = 135 * 1024 * 1024; // Upload safety cap, not compression threshold.

const DOC_TYPE_LABELS: Record<string, string> = {
  rate_confirmation: "Rate Con",
  bill_of_lading:    "BOL",
  proof_of_delivery: "POD",
  lumper_receipt:    "Lumper",
  invoice:           "Invoice",
  receipt:           "Receipt",
  other:             "Other",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  rate_confirmation: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  bill_of_lading:    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  proof_of_delivery: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  lumper_receipt:    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  invoice:           "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  receipt:           "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  other:             "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400",
};

function humanSize(bytes: number) {
  if (bytes < 1024)           return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: UploadedFile["status"]) {
  switch (status) {
    case "completed":  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "processing": return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300";
    case "queued":     return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
    case "failed":     return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300";
    default:           return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300";
  }
}

function statusIcon(status: UploadedFile["status"]) {
  switch (status) {
    case "completed":  return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "processing": return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "queued":     return <Zap className="h-3.5 w-3.5" />;
    case "failed":     return <XCircle className="h-3.5 w-3.5" />;
    default:           return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
}

/** Polls extraction status and calls back with status + classification info */
function ExtractionPoller({
  documentId,
  onStatusChange,
}: {
  documentId: number;
  onStatusChange: (s: UploadedFile["status"], meta?: { candidateDocumentType?: string | null; finalDocumentType?: string | null }) => void;
}) {
  useQuery({
    queryKey: ["/api/load-documents", documentId, "extraction-status"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/extraction-status`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("fetch failed");
      return r.json() as Promise<{
        status: string;
        candidateDocumentType?: string | null;
        finalDocumentType?: string | null;
      }>;
    },
    refetchInterval: (data) => {
      const s = (data as any)?.status;
      if (s === "completed" || s === "failed") return false;
      return 2500;
    },
    select: (d) => {
      onStatusChange(d.status as UploadedFile["status"], {
        candidateDocumentType: d.candidateDocumentType,
        finalDocumentType:     d.finalDocumentType,
      });
      return d;
    },
  });
  return null;
}

export default function DocumentIntakeZone({ entityType, entityId, onUploadComplete, compact, neuStyle }: Props) {
  const qc       = useQueryClient();
  const BadgeView = neuStyle ? NeuBadge : BadgePrimitive;
  const FileSurface = neuStyle ? NeuCard : "div";
  const inputRef = useRef<HTMLInputElement>(null);
  const [files,       setFiles]       = useState<UploadedFile[]>([]);
  const [reviewDocId, setReviewDocId] = useState<number | null>(null);
  const [rejectBanner, setRejectBanner] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState("");

  const updateFile = useCallback((localId: string, patch: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));
  }, []);

  // ── Core upload function ─────────────────────────────────────────────────
  const uploadFile = useCallback(
    async (file: File, selectedDocumentType: string) => {
      const localId = `${Date.now()}-${Math.random()}`;
      setFiles((prev) => [
        {
          localId,
          name:     file.name,
          size:     file.size,
          mimeType: file.type,
          progress: 0,
          documentId: null,
          status:   "uploading",
          expanded: false,
          candidateDocumentType: null,
          finalDocumentType:     null,
        },
        ...prev,
      ]);

      const formData = new FormData();
      formData.append("file",       file);
      formData.append("entityType", entityType);
      formData.append("entityId",   String(entityId));
      formData.append("documentType", selectedDocumentType);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/load-documents/intake");
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          updateFile(localId, { progress: Math.round((e.loaded / e.total) * 90) });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const doc = JSON.parse(xhr.responseText);
          updateFile(localId, {
            progress:   100,
            documentId: doc.documentId,
            status:     "queued",
          });
          qc.invalidateQueries({ queryKey: ["/api/invoices", entityId, "detail"] });
          qc.invalidateQueries({ queryKey: ["/api/invoices", entityId, "documents"] });
          qc.invalidateQueries({ queryKey: ["/api/invoices", entityId, "document-status"] });
          onUploadComplete?.(doc);
        } else {
          let errMsg = "Upload failed";
          try { errMsg = JSON.parse(xhr.responseText)?.message ?? errMsg; } catch {}
          updateFile(localId, { status: "failed", error: errMsg });
        }
      };

      xhr.onerror = () => updateFile(localId, { status: "failed", error: "Network error — check connection" });
      xhr.send(formData);
    },
    [entityType, entityId, updateFile, onUploadComplete, qc],
  );

  // ── Validate then upload ─────────────────────────────────────────────────
  const handleFiles = useCallback(
    (incoming: File[]) => {
      setRejectBanner(null);
      if (!documentType) {
        setRejectBanner("Select a document type before uploading.");
        return;
      }
      const rejected: string[] = [];

      incoming.forEach((file) => {
        if (!ALLOWED_TYPES.includes(file.type)) {
          rejected.push(`${file.name} — unsupported document type`);
          return;
        }
        if (file.size > MAX_SIZE) {
          rejected.push(`${file.name} — exceeds 135 MB upload limit`);
          return;
        }
        uploadFile(file, documentType);
      });

      if (rejected.length > 0) {
        setRejectBanner(rejected.join(" · "));
        setTimeout(() => setRejectBanner(null), 6000);
      }
    },
    [uploadFile, documentType],
  );

  // ── Safe drop hook (fixes browser takeover + child-element flickering) ───
  const { dropProps, isDragOver, isValidDrag } = useSafeDrop({
    onFiles: handleFiles,
    accept:  ALLOWED_TYPES,
  });

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(Array.from(e.target.files ?? []));
      e.target.value = "";
    },
    [handleFiles],
  );

  return (
    <div className={cn("space-y-3", neuStyle && "ff-neu-document-intake")}>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          Document type
        </label>
        <Select value={documentType} onValueChange={setDocumentType}>
          <SelectTrigger className={cn("h-10 rounded-xl bg-white dark:bg-slate-950", neuStyle && "ff-invoice-select-trigger")}>
            <SelectValue placeholder="Select the type before uploading" />
          </SelectTrigger>
          <SelectContent className={neuStyle ? "ff-invoice-neu-select-content" : undefined}>
            <SelectItem value="rate_confirmation">Rate Confirmation</SelectItem>
            <SelectItem value="bol">Bill of Lading (BOL)</SelectItem>
            <SelectItem value="commercial_invoice">Commercial Invoice</SelectItem>
            <SelectItem value="pod">Proof of Delivery (POD)</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Rejection banner */}
      {rejectBanner && (
        <NeuNotice severity="block" className="flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{rejectBanner}</span>
        </NeuNotice>
      )}

      {/* Drop zone */}
      <FileSurface
        {...dropProps}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl transition-all duration-150",
          neuStyle
            ? "border-0 bg-[#e0e0e0]"
            : "border-2 border-dashed",
          compact ? "py-6" : "py-10",
          isDragOver && isValidDrag
            ? "border-blue-400 bg-blue-50/70 scale-[1.01] dark:border-blue-500 dark:bg-blue-950/25"
            : isDragOver && !isValidDrag
              ? "border-red-400 bg-red-50/60 dark:border-red-500 dark:bg-red-950/20"
              : "border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-blue-700",
        )}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.heic,.heif,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={handleInputChange}
        />

        {/* Icon */}
        <div className={cn(
          "mb-3 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
          isDragOver && isValidDrag
            ? "bg-blue-100 dark:bg-blue-900/40"
            : isDragOver && !isValidDrag
              ? "bg-red-100 dark:bg-red-900/30"
              : "bg-slate-100 dark:bg-slate-800",
        )}>
          <Upload className={cn(
            "h-5 w-5",
            isDragOver && isValidDrag   ? "text-blue-500"
            : isDragOver && !isValidDrag ? "text-red-400"
            :                             "text-slate-400",
          )} />
        </div>

        {/* Label */}
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {isDragOver && isValidDrag
            ? "Release to upload"
            : isDragOver && !isValidDrag
              ? "File type not supported"
              : "Drag & drop documents here"}
        </p>
        <p className="mt-1 text-xs text-slate-400">PDF, JPG, PNG · max 10 MB · tagged with the selected type</p>

        <IntakeAction neuStyle={neuStyle}
          variant="outline"
          size="sm"
          className="mt-4 rounded-xl px-4 text-xs"
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        >
          Browse files
        </IntakeAction>
      </FileSurface>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => {
            const displayType = f.finalDocumentType || f.candidateDocumentType;
            return (
                <FileSurface
                key={f.localId}
                className={cn(
                  "overflow-hidden rounded-xl",
                  neuStyle
                    ? "border-0 bg-[#e0e0e0]"
                    : "border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60",
                )}
              >
                {/* File row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-white">
                      {f.name}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-slate-400">{humanSize(f.size)}</span>
                      {f.status === "uploading" && (
                        <Progress value={f.progress} className="h-1 w-24" />
                      )}
                    </div>
                  </div>

                  {/* Classification badge */}
                  {f.status === "completed" && displayType && (
                    <BadgeView className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0",
                      DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
                    )}>
                      <Tag className="h-2.5 w-2.5" />
                      {DOC_TYPE_LABELS[displayType] ?? displayType.replace(/_/g, " ")}
                    </BadgeView>
                  )}

                  <BadgeView className={cn("flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium shrink-0", statusColor(f.status))}>
                    {statusIcon(f.status)}
                    {f.status === "uploading" ? `${f.progress}%` : f.status}
                  </BadgeView>

                  {f.documentId && f.status === "completed" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <IntakeAction neuStyle={neuStyle}
                        size="sm"
                        className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] bg-violet-600 hover:bg-violet-700 text-white font-medium"
                        onClick={() => setReviewDocId(f.documentId!)}
                      >
                        <ClipboardCheck className="h-3 w-3" />
                        Review
                      </IntakeAction>
                      <IntakeAction neuStyle={neuStyle}
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded-lg p-0 text-slate-400 hover:text-slate-600"
                        onClick={() => updateFile(f.localId, { expanded: !f.expanded })}
                      >
                        {f.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </IntakeAction>
                    </div>
                  )}
                </div>

                {/* Upload progress bar */}
                {f.status === "uploading" && (
                  <Progress value={f.progress} className="h-0.5 rounded-none" />
                )}

                {/* Extraction polling */}
                {f.documentId && (f.status === "queued" || f.status === "processing") && (
                  <ExtractionPoller
                    documentId={f.documentId}
                    onStatusChange={(s, meta) =>
                      updateFile(f.localId, {
                        status:                s,
                        candidateDocumentType: meta?.candidateDocumentType,
                        finalDocumentType:     meta?.finalDocumentType,
                      })
                    }
                  />
                )}

                {/* Extraction results panel */}
                {f.documentId && f.expanded && f.status === "completed" && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <ExtractionResultPanel documentId={f.documentId} />
                  </div>
                )}

                {/* Error row */}
                {f.status === "failed" && f.error && (
                  <NeuNotice severity="block" className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {f.error}
                  </NeuNotice>
                )}
              </FileSurface>
            );
          })}
        </div>
      )}

      {/* Full document review dialog */}
      {reviewDocId !== null && (
        <DocumentReviewDialog
          documentId={reviewDocId}
          open={reviewDocId !== null}
          neuStyle={neuStyle}
          onOpenChange={(open) => { if (!open) setReviewDocId(null); }}
          onReviewComplete={(_status, invoiceId) => {
            if (invoiceId) {
              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "document-status"] });
              qc.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "detail"] });
            }
          }}
        />
      )}
    </div>
  );
}

import { useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
} from "lucide-react";
import ExtractionResultPanel from "./extraction-result-panel";

export type IntakeEntityType = "invoice" | "load" | "client" | "broker";

interface Props {
  entityType: IntakeEntityType;
  entityId: number;
  onUploadComplete?: (doc: any) => void;
  compact?: boolean;
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

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/tiff"];
const MAX_SIZE = 10 * 1024 * 1024;

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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
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

export default function DocumentIntakeZone({ entityType, entityId, onUploadComplete, compact }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const updateFile = useCallback((localId: string, patch: Partial<UploadedFile>) => {
    setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!ALLOWED_TYPES.includes(file.type)) return;
      if (file.size > MAX_SIZE) return;

      const localId = `${Date.now()}-${Math.random()}`;
      setFiles((prev) => [
        {
          localId,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          progress: 0,
          documentId: null,
          status: "uploading",
          expanded: false,
          candidateDocumentType: null,
          finalDocumentType: null,
        },
        ...prev,
      ]);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", String(entityId));

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
            progress: 100,
            documentId: doc.documentId,
            status: "queued",
          });
          qc.invalidateQueries({ queryKey: ["/api/invoices", entityId, "detail"] });
          qc.invalidateQueries({ queryKey: ["/api/invoices", entityId, "documents"] });
          onUploadComplete?.(doc);
        } else {
          updateFile(localId, { status: "failed", error: "Upload failed" });
        }
      };

      xhr.onerror = () => updateFile(localId, { status: "failed", error: "Network error" });
      xhr.send(formData);
    },
    [entityType, entityId, updateFile, onUploadComplete, qc],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      Array.from(e.dataTransfer.files).forEach(uploadFile);
    },
    [uploadFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      Array.from(e.target.files ?? []).forEach(uploadFile);
      e.target.value = "";
    },
    [uploadFile],
  );

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors",
          compact ? "py-6" : "py-10",
          dragActive
            ? "border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/20"
            : "border-slate-200 bg-slate-50/50 hover:border-blue-300 hover:bg-blue-50/30 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-blue-700",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
          className="hidden"
          onChange={handleInputChange}
        />
        <div className={cn(
          "mb-3 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
          dragActive ? "bg-blue-100 dark:bg-blue-900/40" : "bg-slate-100 dark:bg-slate-800",
        )}>
          <Upload className={cn("h-5 w-5", dragActive ? "text-blue-500" : "text-slate-400")} />
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {dragActive ? "Drop files to upload" : "Drag & drop documents here"}
        </p>
        <p className="mt-1 text-xs text-slate-400">PDF, JPG, PNG, TIFF · max 10 MB · auto-classified on upload</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 rounded-xl px-4 text-xs"
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        >
          Browse files
        </Button>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => {
            const displayType = f.finalDocumentType || f.candidateDocumentType;
            return (
              <div
                key={f.localId}
                className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/60"
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

                  {/* Classification badge — shown when extraction is complete */}
                  {f.status === "completed" && displayType && (
                    <Badge className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium shrink-0",
                      DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
                    )}>
                      <Tag className="h-2.5 w-2.5" />
                      {DOC_TYPE_LABELS[displayType] ?? displayType.replace(/_/g, " ")}
                    </Badge>
                  )}

                  <Badge className={cn("flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium shrink-0", statusColor(f.status))}>
                    {statusIcon(f.status)}
                    {f.status === "uploading" ? `${f.progress}%` : f.status}
                  </Badge>

                  {f.documentId && f.status === "completed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 rounded-lg p-0 text-slate-400 hover:text-slate-600"
                      onClick={() => updateFile(f.localId, { expanded: !f.expanded })}
                    >
                      {f.expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>

                {/* Upload progress bar */}
                {f.status === "uploading" && (
                  <Progress value={f.progress} className="h-0.5 rounded-none" />
                )}

                {/* Extraction polling — picks up classification on completion */}
                {f.documentId && (f.status === "queued" || f.status === "processing") && (
                  <ExtractionPoller
                    documentId={f.documentId}
                    onStatusChange={(s, meta) =>
                      updateFile(f.localId, {
                        status: s,
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

                {f.status === "failed" && f.error && (
                  <div className="flex items-center gap-2 border-t border-red-100 bg-red-50/50 px-4 py-2 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {f.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

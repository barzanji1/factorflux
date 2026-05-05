import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RotateCcw,
  FileText,
  Tag,
  Edit3,
  Search,
  Eye,
  EyeOff,
  ClipboardCheck,
  ShieldAlert,
  Check,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentDetail {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  documentType: string;
  candidateDocumentType: string | null;
  finalDocumentType: string | null;
  classificationConfidence: string | null;
  invoiceId: number | null;
  loadId: number | null;
}

interface ExtractionResult {
  extractedText: string | null;
  pageCount: number | null;
  processingMethod: string | null;
}

interface FieldCandidate {
  id: number;
  documentId: number;
  fieldName: string;
  fieldValue: string | null;
  normalizedValue: string | null;
  confidenceScore: string | null;
  sourceSnippet: string | null;
}

interface ReviewData {
  id: number;
  reviewStatus: string;
  reviewNotes: string | null;
  reviewedAt: string;
  finalFieldsJson: Record<string, string> | null;
}

interface Props {
  documentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReviewComplete?: (reviewStatus: string, invoiceId?: number | null) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: "rate_confirmation", label: "Rate Confirmation" },
  { value: "bill_of_lading",   label: "Bill of Lading" },
  { value: "proof_of_delivery", label: "Proof of Delivery" },
  { value: "lumper_receipt",   label: "Lumper Receipt" },
  { value: "invoice",          label: "Invoice" },
  { value: "receipt",          label: "Receipt" },
  { value: "other",            label: "Other" },
] as const;

const DOC_TYPE_COLORS: Record<string, string> = {
  rate_confirmation: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  bill_of_lading:   "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  proof_of_delivery: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  lumper_receipt:   "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  invoice:          "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  receipt:          "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  other:            "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400",
};

const REVIEW_COLORS: Record<string, string> = {
  confirmed:   "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
  rejected:    "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
  unreadable:  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
  pending:     "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400",
};

const FIELD_LABELS: Record<string, string> = {
  amount:            "Rate / Amount",
  load_number:       "Load #",
  invoice_number:    "Invoice #",
  reference_number:  "Reference #",
  broker_name:       "Broker Name",
  carrier_name:      "Carrier Name",
  mc_number:         "MC Number",
  dot_number:        "DOT Number",
  pickup_location:   "Pickup Location",
  delivery_location: "Delivery Location",
  pickup_date:       "Pickup Date",
  delivery_date:     "Delivery Date",
  date:              "Date",
  bol_number:        "BOL Number",
  lumper_amount:     "Lumper Amount",
  pod_signature:     "POD Signature",
};

function docTypeLabel(v: string | null | undefined) {
  if (!v) return "Unknown";
  return DOC_TYPES.find(t => t.value === v)?.label ?? v.replace(/_/g, " ");
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls =
    pct >= 80 ? "text-emerald-600 dark:text-emerald-400"
    : pct >= 60 ? "text-amber-600 dark:text-amber-400"
    : "text-red-500 dark:text-red-400";
  const dot =
    pct >= 80 ? "bg-emerald-500"
    : pct >= 60 ? "bg-amber-400"
    : "bg-red-400";
  return (
    <span className={cn("flex items-center gap-1 text-[11px] font-medium tabular-nums", cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {pct}%
    </span>
  );
}

// ─── Inline-editable field row ────────────────────────────────────────────────

function FieldRow({
  candidate,
  editedValues,
  onEdit,
  showSnippet,
}: {
  candidate: FieldCandidate;
  editedValues: Record<number, string>;
  onEdit: (id: number, value: string) => void;
  showSnippet: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [localVal, setLocalVal] = useState("");
  const conf = parseFloat(candidate.confidenceScore ?? "0");
  const isLow = conf < 0.6;
  const displayVal = editedValues[candidate.id] ?? candidate.fieldValue ?? "";

  const startEdit = () => {
    setLocalVal(displayVal);
    setEditing(true);
  };
  const commitEdit = () => {
    onEdit(candidate.id, localVal);
    setEditing(false);
  };
  const cancelEdit = () => setEditing(false);

  const isEdited = candidate.id in editedValues && editedValues[candidate.id] !== candidate.fieldValue;

  return (
    <>
      <tr className={cn(
        "border-b border-slate-50 dark:border-slate-800/60 group",
        isLow && "bg-amber-50/30 dark:bg-amber-950/10",
      )}>
        <td className="px-3 py-2 min-w-[130px]">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {FIELD_LABELS[candidate.fieldName] ?? candidate.fieldName.replace(/_/g, " ")}
            </span>
            {isLow && (
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" aria-label="Low confidence" />
            )}
            {isEdited && (
              <span className="text-[10px] text-violet-500 font-medium">edited</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 w-full">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={localVal}
                onChange={e => setLocalVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                className="h-6 rounded-md px-2 text-xs font-mono"
              />
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700" onClick={commitEdit}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600" onClick={cancelEdit}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "font-mono text-xs",
                isEdited ? "text-violet-700 dark:text-violet-300" : "text-slate-800 dark:text-slate-100",
              )}>
                {displayVal || <span className="text-slate-300 italic">—</span>}
              </span>
              <button
                onClick={startEdit}
                className="invisible group-hover:visible text-slate-300 hover:text-slate-500 transition-colors"
                title="Edit value"
              >
                <Edit3 className="h-3 w-3" />
              </button>
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <ConfidenceBadge score={conf} />
        </td>
      </tr>
      {showSnippet && candidate.sourceSnippet && (
        <tr className="border-b border-slate-50 dark:border-slate-800/60">
          <td colSpan={3} className="px-3 pb-2 pt-0">
            <p className="rounded-md border border-slate-100 bg-white/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              …{candidate.sourceSnippet}…
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

export default function DocumentReviewDialog({
  documentId,
  open,
  onOpenChange,
  onReviewComplete,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Local state
  const [notes, setNotes] = useState("");
  const [editedValues, setEditedValues] = useState<Record<number, string>>({});
  const [showSnippets, setShowSnippets] = useState(false);
  const [textSearch, setTextSearch] = useState("");
  const [editingType, setEditingType] = useState(false);
  const [pendingType, setPendingType] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: doc, isLoading: docLoading } = useQuery<DocumentDetail>({
    queryKey: ["/api/load-documents", documentId, "detail"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/detail`, { credentials: "include" });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
    enabled: open && documentId > 0,
  });

  const { data: extraction } = useQuery<ExtractionResult | null>({
    queryKey: ["/api/load-documents", documentId, "extraction-result"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/extraction-result`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: open && documentId > 0,
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<FieldCandidate[]>({
    queryKey: ["/api/load-documents", documentId, "field-candidates"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/field-candidates`, { credentials: "include" });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
    enabled: open && documentId > 0,
  });

  const { data: review } = useQuery<ReviewData | null>({
    queryKey: ["/api/load-documents", documentId, "review"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/review`, { credentials: "include" });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: open && documentId > 0,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const reviewMutation = useMutation({
    mutationFn: (payload: { reviewStatus: string; reviewNotes: string; finalFieldsJson: Record<string, string> }) =>
      apiRequest("POST", `/api/load-documents/${documentId}/review`, payload),
    onSuccess: async (data: any) => {
      const status = data?.reviewStatus ?? "confirmed";
      toast({
        title: status === "confirmed" ? "Document confirmed" : `Document marked as ${status}`,
        description: status === "confirmed"
          ? "Review saved — document is now linked to the workflow."
          : "Review saved.",
      });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "review"] });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "detail"] });
      if (data?.invoiceId) {
        qc.invalidateQueries({ queryKey: ["/api/invoices", data.invoiceId, "detail"] });
        qc.invalidateQueries({ queryKey: ["/api/invoices", data.invoiceId, "completeness"] });
      }
      onReviewComplete?.(status, data?.invoiceId);
      onOpenChange(false);
    },
    onError: () => toast({ title: "Error", description: "Could not save review.", variant: "destructive" }),
  });

  const docTypeMutation = useMutation({
    mutationFn: (finalDocumentType: string) =>
      apiRequest("PATCH", `/api/load-documents/${documentId}/document-type`, { finalDocumentType }),
    onSuccess: () => {
      toast({ title: "Type updated", description: "Document classification saved." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "detail"] });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "extraction-status"] });
      setEditingType(false);
    },
    onError: () => toast({ title: "Error", description: "Could not update type.", variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/load-documents/${documentId}/retry-extraction`, {}),
    onSuccess: () => {
      toast({ title: "Re-processing started", description: "Extraction has been queued again." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "extraction-status"] });
      onOpenChange(false);
    },
    onError: () => toast({ title: "Error", description: "Could not retry extraction.", variant: "destructive" }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleEdit = useCallback((id: number, value: string) => {
    setEditedValues(prev => ({ ...prev, [id]: value }));
  }, []);

  const submitReview = (status: string) => {
    const finalFieldsJson: Record<string, string> = {};
    for (const [idStr, val] of Object.entries(editedValues)) {
      const cand = candidates?.find(c => c.id === parseInt(idStr));
      if (cand) finalFieldsJson[cand.fieldName] = val;
    }
    reviewMutation.mutate({ reviewStatus: status, reviewNotes: notes, finalFieldsJson });
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  const displayType = doc?.finalDocumentType || doc?.candidateDocumentType;
  const confidence  = doc?.classificationConfidence ? parseFloat(doc.classificationConfidence) : null;
  const isOverridden = !!doc?.finalDocumentType;
  const fieldCandidates = (candidates ?? []).filter(c => c.fieldName !== "document_type");
  const lowConfFields = fieldCandidates.filter(c => parseFloat(c.confidenceScore ?? "0") < 0.6);
  const isPDF   = doc?.mimeType === "application/pdf";
  const isImage = doc?.mimeType?.startsWith("image/");
  const fileUrl = doc ? `/uploads/${doc.filename}` : "";

  const filteredText = (() => {
    const raw = extraction?.extractedText ?? "";
    if (!textSearch.trim()) return raw;
    return raw; // full text shown; search highlight handled via browser Ctrl+F
  })();

  const isAlreadyReviewed = !!review && review.reviewStatus !== "pending";

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-full h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 border-b border-slate-100 dark:border-slate-800 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              <DialogTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                {docLoading ? "Loading…" : doc?.originalName ?? `Document #${documentId}`}
              </DialogTitle>
              {doc && (
                <span className="text-xs text-slate-400 shrink-0">{fmtBytes(doc.size)}</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Classification badge + override */}
              {displayType && (
                <Badge className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold flex items-center gap-1",
                  DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
                )}>
                  <Tag className="h-2.5 w-2.5" />
                  {docTypeLabel(displayType)}
                  {isOverridden && <span className="opacity-60 ml-0.5">·override</span>}
                </Badge>
              )}
              {confidence !== null && (
                <ConfidenceBadge score={confidence} />
              )}
              {/* Already-reviewed badge */}
              {isAlreadyReviewed && (
                <Badge className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] capitalize",
                  REVIEW_COLORS[review!.reviewStatus] ?? REVIEW_COLORS.pending,
                )}>
                  {review!.reviewStatus === "confirmed" && <CheckCircle2 className="mr-1 h-3 w-3" />}
                  {review!.reviewStatus === "rejected" && <XCircle className="mr-1 h-3 w-3" />}
                  {review!.reviewStatus}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* ── Body (side-by-side) ─────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: file preview */}
          <div className="w-[42%] shrink-0 flex flex-col border-r border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">File Preview</span>
              {fileUrl && (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-500 hover:underline flex items-center gap-1"
                >
                  <Eye className="h-3 w-3" />
                  Open full size
                </a>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              {docLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                </div>
              ) : isPDF && fileUrl ? (
                <iframe
                  src={fileUrl}
                  title="Document preview"
                  className="h-full w-full border-0"
                />
              ) : isImage && fileUrl ? (
                <div className="flex h-full items-center justify-center overflow-auto p-3">
                  <img
                    src={fileUrl}
                    alt={doc?.originalName}
                    className="max-w-full object-contain rounded-lg shadow-sm"
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center flex-col gap-2 text-slate-300">
                  <FileText className="h-10 w-10" />
                  <p className="text-sm text-slate-400">Preview unavailable</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: extracted data */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Tabs defaultValue="fields" className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 shrink-0">
                <TabsList className="h-7 rounded-lg text-xs">
                  <TabsTrigger value="fields" className="h-6 px-3 text-xs">
                    Fields
                    {fieldCandidates.length > 0 && (
                      <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                        {fieldCandidates.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="text" className="h-6 px-3 text-xs">
                    Extracted Text
                  </TabsTrigger>
                  <TabsTrigger value="type" className="h-6 px-3 text-xs">
                    Classification
                  </TabsTrigger>
                </TabsList>
                {/* Snippet toggle */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px] text-slate-400 hover:text-slate-600"
                  onClick={() => setShowSnippets(v => !v)}
                >
                  {showSnippets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showSnippets ? "Hide" : "Show"} snippets
                </Button>
              </div>

              {/* ── Fields tab ─────────────────────────────────────────────── */}
              <TabsContent value="fields" className="flex-1 min-h-0 overflow-auto m-0 p-0">
                {/* Low-confidence warning strip */}
                {lowConfFields.length > 0 && (
                  <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-700 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      <strong>{lowConfFields.length} field{lowConfFields.length !== 1 ? "s" : ""}</strong> with low extraction confidence (below 60%) —&nbsp;
                      {lowConfFields.map(f => FIELD_LABELS[f.fieldName] ?? f.fieldName).join(", ")}.
                      Review and edit before confirming.
                    </span>
                  </div>
                )}

                {candidatesLoading ? (
                  <div className="flex items-center gap-2 p-4 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading extracted fields…
                  </div>
                ) : fieldCandidates.length === 0 ? (
                  <div className="flex items-center gap-2 m-4 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    No fields could be extracted — this may be a scanned image or handwritten document.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-slate-100 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-800/70 backdrop-blur">
                        <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 min-w-[130px]">Field</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 w-full">Value</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldCandidates.map(c => (
                        <FieldRow
                          key={c.id}
                          candidate={c}
                          editedValues={editedValues}
                          onEdit={handleEdit}
                          showSnippet={showSnippets}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </TabsContent>

              {/* ── Extracted text tab ─────────────────────────────────────── */}
              <TabsContent value="text" className="flex-1 min-h-0 overflow-hidden m-0 p-0 flex flex-col">
                <div className="relative px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input
                    placeholder="Type to search extracted text (or use Ctrl+F for in-page search)…"
                    value={textSearch}
                    onChange={e => setTextSearch(e.target.value)}
                    className="h-7 pl-7 text-xs rounded-lg"
                  />
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {!extraction?.extractedText ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      No text extracted — file may be a scanned image or extraction is still running.
                    </div>
                  ) : (
                    <pre className="font-mono text-[11.5px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                      {filteredText || <span className="text-slate-300 italic">No matches for "{textSearch}"</span>}
                    </pre>
                  )}
                </div>
                {extraction?.pageCount && (
                  <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 px-3 py-1.5 text-[11px] text-slate-400">
                    {extraction.pageCount} page{extraction.pageCount !== 1 ? "s" : ""} · {extraction.processingMethod ?? "extracted"}
                  </div>
                )}
              </TabsContent>

              {/* ── Classification tab ─────────────────────────────────────── */}
              <TabsContent value="type" className="flex-1 min-h-0 overflow-auto m-0 p-4 space-y-4">
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                  <div className="bg-slate-50/80 dark:bg-slate-800/40 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                      Auto-Classification Result
                    </span>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="flex items-center gap-3">
                      {displayType ? (
                        <Badge className={cn(
                          "rounded-full border px-3 py-0.5 text-xs font-semibold",
                          DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
                        )}>
                          {docTypeLabel(displayType)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Not yet classified</span>
                      )}
                      {confidence !== null && (
                        <div className="flex items-center gap-1.5">
                          <ConfidenceBadge score={confidence} />
                          <span className="text-[11px] text-slate-400">classification confidence</span>
                        </div>
                      )}
                      {isOverridden && (
                        <Badge className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0 text-[10px] text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                          agent override
                        </Badge>
                      )}
                    </div>
                    {/* Override controls */}
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 rounded-lg text-xs"
                        onClick={() => {
                          setPendingType(displayType ?? "other");
                          setEditingType(v => !v);
                        }}
                      >
                        <Edit3 className="h-3 w-3" />
                        {editingType ? "Cancel override" : "Override type"}
                      </Button>
                      {editingType && (
                        <div className="mt-2 flex items-center gap-2">
                          <Select value={pendingType} onValueChange={setPendingType}>
                            <SelectTrigger className="h-7 w-48 rounded-lg text-xs">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              {DOC_TYPES.map(t => (
                                <SelectItem key={t.value} value={t.value} className="text-xs">
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-7 rounded-lg px-3 text-xs"
                            disabled={docTypeMutation.isPending || !pendingType}
                            onClick={() => docTypeMutation.mutate(pendingType)}
                          >
                            {docTypeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Classification info */}
                {confidence !== null && confidence < 0.6 && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Classification confidence is below 60%. The auto-detected type may be incorrect.
                      Please verify and override if necessary before confirming.
                    </span>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* ── Footer: notes + action buttons ─────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-5 py-3">
          {isAlreadyReviewed ? (
            <div className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs",
              REVIEW_COLORS[review!.reviewStatus] ?? REVIEW_COLORS.pending,
            )}>
              {review!.reviewStatus === "confirmed" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
              <span>
                <strong className="capitalize">{review!.reviewStatus}</strong>
                {review!.reviewNotes ? ` — ${review!.reviewNotes}` : ""}
                {Object.keys(review!.finalFieldsJson ?? {}).length > 0 && (
                  <span className="ml-1 opacity-70">· {Object.keys(review!.finalFieldsJson!).length} field value(s) saved</span>
                )}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                placeholder="Agent notes (optional) — describe any issues, corrections made, or observations…"
                rows={2}
                className="resize-none rounded-xl text-xs flex-1"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap justify-end shrink-0">
                <Button
                  size="sm"
                  className="gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs hover:bg-emerald-700 font-medium"
                  disabled={reviewMutation.isPending}
                  onClick={() => submitReview("confirmed")}
                  title="Confirm all extracted fields and link document to workflow"
                >
                  {reviewMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ClipboardCheck className="h-3.5 w-3.5" />}
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl px-3 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400"
                  disabled={reviewMutation.isPending}
                  onClick={() => submitReview("rejected")}
                  title="Reject this document — it will not count toward requirements"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl px-3 text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
                  disabled={reviewMutation.isPending}
                  onClick={() => submitReview("unreadable")}
                  title="Mark as unreadable — agent cannot verify content"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Unreadable
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-xl px-3 text-xs text-slate-500"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate()}
                  title="Re-run OCR extraction on this document"
                >
                  {retryMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />}
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  Sparkles,
  ClipboardCheck,
  Eye,
  EyeOff,
  Tag,
  Edit3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface FieldCandidate {
  id: number;
  documentId: number;
  fieldName: string;
  fieldValue: string;
  normalizedValue: string;
  confidenceScore: string;
  sourceSnippet: string;
}

interface ReviewData {
  id: number;
  reviewStatus: string;
  reviewNotes: string;
  reviewedAt: string;
}

interface ClassificationData {
  candidateDocumentType: string | null;
  finalDocumentType: string | null;
  classificationConfidence: string | null;
}

interface Props {
  documentId: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DOC_TYPES = [
  { value: "rate_confirmation",  label: "Rate Confirmation" },
  { value: "bill_of_lading",     label: "Bill of Lading" },
  { value: "proof_of_delivery",  label: "Proof of Delivery" },
  { value: "lumper_receipt",     label: "Lumper Receipt" },
  { value: "invoice",            label: "Invoice" },
  { value: "receipt",            label: "Receipt" },
  { value: "other",              label: "Other" },
] as const;

const DOC_TYPE_COLORS: Record<string, string> = {
  rate_confirmation: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  bill_of_lading:    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  proof_of_delivery: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  lumper_receipt:    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  invoice:           "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  receipt:           "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  other:             "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
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
  document_type:     "Doc Type (auto)",
};

function docTypeLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  return DOC_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, " ");
}

function ConfidencePip({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-emerald-500"
    : pct >= 60 ? "bg-amber-400"
    : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-2 w-2 rounded-full", color)} />
      <span className="text-[11px] text-slate-400">{pct}%</span>
    </div>
  );
}

export default function ExtractionResultPanel({ documentId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showSnippets, setShowSnippets] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [pendingType, setPendingType] = useState<string>("");

  const { data: candidates, isLoading: candidatesLoading } = useQuery<FieldCandidate[]>({
    queryKey: ["/api/load-documents", documentId, "field-candidates"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/field-candidates`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
  });

  const { data: classificationData, isLoading: classLoading } = useQuery<ClassificationData>({
    queryKey: ["/api/load-documents", documentId, "extraction-status"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/extraction-status`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("fetch failed");
      return r.json();
    },
    select: (d: any) => ({
      candidateDocumentType:    d.candidateDocumentType ?? null,
      finalDocumentType:        d.finalDocumentType ?? null,
      classificationConfidence: d.classificationConfidence ?? null,
    }),
  });

  const { data: review } = useQuery<ReviewData | null>({
    queryKey: ["/api/load-documents", documentId, "review"],
    queryFn: async () => {
      const r = await fetch(`/api/load-documents/${documentId}/review`, {
        credentials: "include",
      });
      if (!r.ok) return null;
      return r.json();
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (payload: { reviewStatus: string; reviewNotes: string }) =>
      apiRequest("POST", `/api/load-documents/${documentId}/review`, payload),
    onSuccess: () => {
      toast({ title: "Review saved", description: "Document fields confirmed." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "review"] });
    },
    onError: () => toast({ title: "Error", description: "Could not save review.", variant: "destructive" }),
  });

  const docTypeMutation = useMutation({
    mutationFn: (finalDocumentType: string) =>
      apiRequest("PATCH", `/api/load-documents/${documentId}/document-type`, { finalDocumentType }),
    onSuccess: () => {
      toast({ title: "Document type saved", description: "Classification updated." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "extraction-status"] });
      setEditingType(false);
    },
    onError: () => toast({ title: "Error", description: "Could not update document type.", variant: "destructive" }),
  });

  if (candidatesLoading || classLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading extracted fields…
      </div>
    );
  }

  const hasCandidates = candidates && candidates.length > 0;
  const displayType   = classificationData?.finalDocumentType || classificationData?.candidateDocumentType;
  const confidence    = classificationData?.classificationConfidence
    ? parseFloat(classificationData.classificationConfidence)
    : null;
  const isOverridden  = !!classificationData?.finalDocumentType;

  // Exclude the document_type field from the regular table (shown in classification header)
  const fieldCandidates = candidates?.filter((c) => c.fieldName !== "document_type") ?? [];

  return (
    <div className="px-4 py-4 space-y-4">

      {/* ── Classification Banner ────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between bg-slate-50/80 dark:bg-slate-800/40 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">
              Document Classification
            </span>
            {isOverridden && (
              <Badge className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                overridden
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-slate-400 hover:text-slate-600"
            onClick={() => {
              setPendingType(displayType ?? "other");
              setEditingType((v) => !v);
            }}
          >
            <Edit3 className="h-3 w-3" />
            {editingType ? "Cancel" : "Override"}
          </Button>
        </div>

        <div className="px-3 py-2.5 space-y-2">
          {/* Current type badge */}
          {displayType ? (
            <div className="flex items-center gap-3">
              <Badge className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
              )}>
                {docTypeLabel(displayType)}
              </Badge>
              {confidence !== null && (
                <div className="flex items-center gap-1.5">
                  <ConfidencePip score={confidence} />
                  <span className="text-[11px] text-slate-400">classification confidence</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Not yet classified — extraction may still be running.</p>
          )}

          {/* Override select */}
          {editingType && (
            <div className="flex items-center gap-2 pt-1">
              <Select value={pendingType} onValueChange={setPendingType}>
                <SelectTrigger className="h-7 w-48 rounded-lg text-xs">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPES.map((t) => (
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

      {/* ── Field candidates ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Extracted Fields
          </span>
          {hasCandidates && (
            <Badge className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0 text-[11px] text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
              {fieldCandidates.length} field{fieldCandidates.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        {hasCandidates && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-slate-400 hover:text-slate-600"
            onClick={() => setShowSnippets((v) => !v)}
          >
            {showSnippets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showSnippets ? "Hide" : "Show"} snippets
          </Button>
        )}
      </div>

      {fieldCandidates.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No fields could be extracted — this may be a scanned image or handwritten document.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40">
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Field</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Value</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {fieldCandidates.map((c, i) => (
                <>
                  <tr
                    key={c.id}
                    className={cn(
                      "border-b border-slate-50 dark:border-slate-800/60",
                      i % 2 === 0 ? "bg-white dark:bg-slate-900/20" : "bg-slate-50/40 dark:bg-slate-900/40",
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">
                      {FIELD_LABELS[c.fieldName] ?? c.fieldName.replace(/_/g, " ")}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-100">
                      {c.fieldValue}
                    </td>
                    <td className="px-3 py-2">
                      <ConfidencePip score={parseFloat(c.confidenceScore ?? "0")} />
                    </td>
                  </tr>
                  {showSnippets && c.sourceSnippet && (
                    <tr
                      key={`${c.id}-snip`}
                      className="border-b border-slate-50 bg-slate-50/70 dark:border-slate-800/60 dark:bg-slate-800/30"
                    >
                      <td colSpan={3} className="px-3 pb-2 pt-0">
                        <p className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                          …{c.sourceSnippet}…
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Review section ───────────────────────────────────────────────── */}
      {review ? (
        <div className={cn(
          "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs",
          review.reviewStatus === "confirmed"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
        )}>
          {review.reviewStatus === "confirmed"
            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            : <XCircle className="h-3.5 w-3.5 shrink-0" />}
          <span>
            <strong className="capitalize">{review.reviewStatus}</strong>
            {review.reviewNotes ? ` — ${review.reviewNotes}` : ""}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Review notes (optional)
          </Label>
          <Textarea
            placeholder="Add notes about the extracted data…"
            rows={2}
            className="resize-none rounded-xl text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs hover:bg-emerald-700"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate({ reviewStatus: "confirmed", reviewNotes: notes })}
            >
              {reviewMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ClipboardCheck className="h-3.5 w-3.5" />
              )}
              Confirm fields
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 rounded-xl px-3 text-xs text-red-600 hover:text-red-700"
              disabled={reviewMutation.isPending}
              onClick={() => reviewMutation.mutate({ reviewStatus: "unreadable", reviewNotes: notes })}
            >
              <XCircle className="h-3.5 w-3.5" />
              Mark unreadable
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

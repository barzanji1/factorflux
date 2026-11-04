import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sparkles,
  Tag,
  Edit3,
  Loader2,
  Cpu,
  BookOpen,
  UserCheck,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { NeuNotice } from "@/components/shared/NeuNotice";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationData {
  candidateDocumentType:      string | null;
  finalDocumentType:          string | null;
  classificationConfidence:   string | null;
  aiDocumentType:             string | null;
  aiClassificationConfidence: string | null;
  aiClassificationSignals:    string[] | null;
  allClassificationScores:    Record<string, number> | null;
  classificationSource:       "rules" | "ai" | "agent" | null;
  aiClassifiedAt:             string | null;
  aiClassificationModel:      string | null;
}

interface Props {
  documentId:         number;
  classificationData: ClassificationData | null;
  isLoading:          boolean;
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
  freight_invoice:   "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  receipt:           "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  other:             "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
};

const DOC_TYPE_BAR_COLORS: Record<string, string> = {
  rate_confirmation: "bg-blue-500",
  bill_of_lading:    "bg-violet-500",
  proof_of_delivery: "bg-emerald-500",
  lumper_receipt:    "bg-orange-500",
  freight_invoice:   "bg-indigo-500",
  receipt:           "bg-teal-500",
  other:             "bg-slate-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function docTypeLabel(v: string | null | undefined): string {
  if (!v) return "Unknown";
  return DOC_TYPES.find(t => t.value === v)?.label ?? v.replace(/_/g, " ");
}

function confidenceColor(score: number): string {
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-amber-400";
  if (score >= 0.4) return "bg-orange-500";
  return "bg-red-500";
}

function confidenceLabel(score: number): { text: string; cls: string } {
  if (score >= 0.85) return { text: "High confidence",   cls: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 0.65) return { text: "Medium confidence", cls: "text-amber-600 dark:text-amber-400" };
  if (score >= 0.40) return { text: "Low confidence",    cls: "text-orange-600 dark:text-orange-400" };
  return                     { text: "Very uncertain",   cls: "text-red-600 dark:text-red-400" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const { text, cls } = confidenceLabel(score);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={cn("text-[11px] font-medium", cls)}>{text}</span>
        <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", confidenceColor(score))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SourceBadge({ source, model }: { source: string | null; model: string | null }) {
  if (!source) return null;

  if (source === "ai") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className="gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 cursor-help">
              <Sparkles className="h-2.5 w-2.5" />
              AI
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Classified by {model ?? "AI model"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (source === "agent") {
    return (
      <Badge className="gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        <UserCheck className="h-2.5 w-2.5" />
        Agent
      </Badge>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-help">
            <BookOpen className="h-2.5 w-2.5" />
            Rules
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Classified by pattern-matching rules ({model ?? "rules engine"})
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function AllScoresChart({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 7);

  const maxScore = sorted[0]?.[1] ?? 1;

  return (
    <div className="space-y-1.5">
      {sorted.map(([type, score]) => {
        const pct = Math.round(score * 100);
        const barW = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
        return (
          <div key={type} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {docTypeLabel(type)}
            </span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  DOC_TYPE_BAR_COLORS[type] ?? "bg-slate-400",
                )}
                style={{ width: `${barW}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] font-medium text-slate-600 dark:text-slate-300">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SignalBadges({ signals }: { signals: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {signals.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClassificationPanel({ documentId, classificationData: data, isLoading }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingType, setEditingType]     = useState(false);
  const [pendingType, setPendingType]     = useState("");
  const [showBreakdown, setShowBreakdown] = useState(false);

  const displayType  = data?.finalDocumentType || data?.candidateDocumentType;
  const confidence   = data?.classificationConfidence
    ? parseFloat(data.classificationConfidence) : null;
  const isOverridden = !!data?.finalDocumentType;

  const aiConfidence = data?.aiClassificationConfidence
    ? parseFloat(data.aiClassificationConfidence) : null;
  const signals      = data?.aiClassificationSignals ?? [];
  const allScores    = data?.allClassificationScores;
  const source       = data?.classificationSource ?? "rules";
  const model        = data?.aiClassificationModel ?? null;

  // Does the AI disagree with the current classification?
  const aiDisagrees =
    data?.aiDocumentType &&
    data.aiDocumentType !== displayType &&
    aiConfidence !== null &&
    aiConfidence > 0.6;

  // ── Mutations ────────────────────────────────────────────────────────────────

  const docTypeMutation = useMutation({
    mutationFn: (finalDocumentType: string) =>
      apiRequest("PATCH", `/api/load-documents/${documentId}/document-type`, { finalDocumentType }),
    onSuccess: () => {
      toast({ title: "Document type saved", description: "Classification updated." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "extraction-status"] });
      setEditingType(false);
    },
    onError: () =>
      toast({ title: "Error", description: "Could not update document type.", variant: "destructive" }),
  });

  const reclassifyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/load-documents/${documentId}/ai-classify`, {}),
    onSuccess: () => {
      toast({ title: "Re-classified", description: "AI classification complete." });
      qc.invalidateQueries({ queryKey: ["/api/load-documents", documentId, "extraction-status"] });
    },
    onError: () =>
      toast({ title: "Error", description: "Re-classification failed.", variant: "destructive" }),
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading classification…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────── */}
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
          <SourceBadge source={source} model={model} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-slate-400 hover:text-slate-600"
            onClick={() => reclassifyMutation.mutate()}
            disabled={reclassifyMutation.isPending}
            title="Re-run AI classification"
          >
            {reclassifyMutation.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Re-classify
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-slate-400 hover:text-slate-600"
            onClick={() => {
              setPendingType(displayType ?? "other");
              setEditingType(v => !v);
            }}
          >
            <Edit3 className="h-3 w-3" />
            {editingType ? "Cancel" : "Override"}
          </Button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="px-3 py-3 space-y-3">

        {/* Current type + confidence meter */}
        {displayType ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
              )}>
                {docTypeLabel(displayType)}
              </Badge>
              {source === "ai" && (
                <span className="text-[11px] text-slate-400">AI-classified</span>
              )}
              {source === "rules" && (
                <span className="text-[11px] text-slate-400">Rule-based</span>
              )}
              {source === "agent" && (
                <span className="text-[11px] text-slate-400">Agent override</span>
              )}
            </div>

            {/* Confidence meter */}
            {confidence !== null && <ConfidenceMeter score={confidence} />}
          </div>
        ) : (
          <p className="text-xs text-slate-400 italic">
            Not yet classified — extraction may still be running.
          </p>
        )}

        {/* AI disagrees warning */}
        {aiDisagrees && (
          <NeuNotice severity="ack" className="flex items-start gap-2 text-[11px]">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              AI suggests <strong>{docTypeLabel(data?.aiDocumentType)}</strong>
              {" "}({Math.round((aiConfidence ?? 0) * 100)}% confidence) — consider overriding.
            </span>
          </NeuNotice>
        )}

        {/* Override select */}
        {editingType && (
          <div className="flex items-center gap-2">
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
              {docTypeMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : "Save"}
            </Button>
          </div>
        )}

        {/* Expand/collapse breakdown */}
        {(allScores || signals.length > 0) && (
          <button
            onClick={() => setShowBreakdown(v => !v)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            {showBreakdown
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
            {showBreakdown ? "Hide" : "Show"} breakdown
          </button>
        )}

        {/* Breakdown panel */}
        {showBreakdown && (
          <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 px-3 py-2.5 space-y-3">

            {/* All-type comparison bars */}
            {allScores && Object.keys(allScores).length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Cpu className="h-3 w-3 text-slate-400" />
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    All Type Scores
                  </span>
                </div>
                <AllScoresChart scores={allScores} />
              </div>
            )}

            {/* Signal badges */}
            {signals.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Sparkles className="h-3 w-3 text-violet-400" />
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Matched Signals
                  </span>
                </div>
                <SignalBadges signals={signals} />
              </div>
            )}

            {/* Model info */}
            {model && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Engine: {model}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

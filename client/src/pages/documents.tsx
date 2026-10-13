import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Eye,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Search,
  Sparkles,
  BookOpen,
  UserCheck,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  SlidersHorizontal,
  Brain,
  FileQuestion,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import type { Document } from "@shared/schema";
import { CompressionInfo } from "@/components/documents/compression-info";
import { documentClassification, documentClassificationLabel } from "@shared/document-display";

// ─── Extended document type with AI fields ────────────────────────────────────
interface AIDocument extends Omit<Document, "aiClassifiedAt"> {
  ocrJob?: { id: number; status: string; errorMessage: string | null; parserName: string | null } | null;
  aiDocumentType:             string | null;
  aiClassificationConfidence: string | null;
  aiClassificationSignals:    string[] | null;
  allClassificationScores:    Record<string, number> | null;
  classificationSource:       "rules" | "ai" | "agent" | null;
  aiClassifiedAt:             string | null;
  aiClassificationModel:      string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  rate_confirmation: "Rate Confirmation",
  bill_of_lading:    "Bill of Lading",
  proof_of_delivery: "Proof of Delivery",
  lumper_receipt:    "Lumper Receipt",
  invoice:           "Invoice",
  freight_invoice:   "Freight Invoice",
  receipt:           "Receipt",
  driver_id:         "Driver ID",
  carrier_setup:     "Carrier Setup",
  other:             "Other",
};

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

const BAR_COLORS: Record<string, string> = {
  rate_confirmation: "bg-blue-500",
  bill_of_lading:    "bg-violet-500",
  proof_of_delivery: "bg-emerald-500",
  lumper_receipt:    "bg-orange-500",
  freight_invoice:   "bg-indigo-500",
  receipt:           "bg-teal-500",
  other:             "bg-slate-400",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeLabel(v: string | null | undefined) {
  if (!v) return "Unclassified";
  return documentClassificationLabel(v);
}

function fileSize(bytes: number) {
  if (!bytes) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function confidenceColor(score: number) {
  if (score >= 0.80) return "bg-emerald-500";
  if (score >= 0.60) return "bg-amber-400";
  if (score >= 0.40) return "bg-orange-500";
  return "bg-red-500";
}

function confidenceTextColor(score: number) {
  if (score >= 0.80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.60) return "text-amber-600 dark:text-amber-400";
  if (score >= 0.40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceBadge({ source, model }: { source: string | null; model?: string | null }) {
  if (source === "ai") return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300 cursor-default">
            <Sparkles className="h-2.5 w-2.5" /> AI
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{model ?? "Claude Haiku"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  if (source === "agent") return (
    <Badge className="gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <UserCheck className="h-2.5 w-2.5" /> Agent
    </Badge>
  );
  return (
    <Badge className="gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <BookOpen className="h-2.5 w-2.5" /> Rules
    </Badge>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", confidenceColor(score))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-[11px] font-semibold w-8 text-right shrink-0", confidenceTextColor(score))}>
        {pct}%
      </span>
    </div>
  );
}

function AllScoresRow({ scores }: { scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a).slice(0, 7);
  const max = sorted[0]?.[1] ?? 1;
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {sorted.map(([t, s]) => (
        <div key={t} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {typeLabel(t)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={cn("h-full rounded-full", BAR_COLORS[t] ?? "bg-slate-400")}
              style={{ width: `${max > 0 ? Math.round((s / max) * 100) : 0}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {Math.round(s * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Document row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc, onView, onDownload, focusTargetId }: {
  doc: AIDocument;
  onView: (id: number) => void;
  onDownload: (id: number) => void;
  focusTargetId: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const displayType   = documentClassification(doc);
  const confidence    = doc.classificationConfidence ? parseFloat(doc.classificationConfidence) : null;
  const source        = doc.classificationSource ?? "rules";
  const hasBreakdown  = !!(doc.allClassificationScores || (doc.aiClassificationSignals?.length));
  const retryMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/load-documents/${doc.id}/retry-extraction`, {}),
    onSuccess: () => {
      toast({ title: "OCR retry queued", description: doc.originalName });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (error: Error) => toast({ title: "OCR retry failed", description: error.message, variant: "destructive" }),
  });

  const reclassifyMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/load-documents/${doc.id}/ai-classify`, {}),
    onSuccess: () => {
      toast({ title: "Re-classified", description: `${doc.originalName} re-classified successfully.` });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
    },
    onError: () => toast({ title: "Error", description: "Re-classification failed.", variant: "destructive" }),
  });

  return (
    <>
      {/* ── Main row ──────────────────────────────────────────────────────── */}
      <tr
        id={`document-row-${doc.id}`}
        data-testid={`document-row-${doc.id}`}
        tabIndex={-1}
        className={cn(
          "border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors group focus:outline focus:outline-2 focus:outline-[#087c8d]",
          focusTargetId === doc.id && "bg-[#e5f1ef] outline outline-2 outline-[#087c8d] outline-offset-[-2px]",
        )}
      >

        {/* Expand toggle + filename */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setExpanded(v => !v)}
              disabled={!hasBreakdown}
              className={cn(
                "shrink-0 rounded p-0.5 transition-colors",
                hasBreakdown
                  ? "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  : "text-slate-200 dark:text-slate-700 cursor-default",
              )}
            >
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100 max-w-[220px]">
                {doc.originalName}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {fileSize(doc.size)} · {doc.invoiceId ? `Invoice #${doc.invoiceId}` : doc.loadId ? `Load #${doc.loadId}` : "No link"}
              </p>
              <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
            </div>
          </div>
        </td>

        {/* Classification type */}
        <td className="px-4 py-3">
          {displayType ? (
            <Badge className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
              DOC_TYPE_COLORS[displayType] ?? DOC_TYPE_COLORS.other,
            )}>
              {typeLabel(displayType)}
            </Badge>
          ) : (
            <span className="text-[11px] text-slate-400 italic">Not classified</span>
          )}
        </td>

        {/* Confidence */}
        <td className="px-4 py-3 w-36">
          {confidence !== null
            ? <ConfidenceBar score={confidence} />
            : <span className="text-[11px] text-slate-400">—</span>}
        </td>

        {/* Source */}
        <td className="px-4 py-3">
          <SourceBadge source={source} model={doc.aiClassificationModel} />
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <Badge className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
            doc.status === "processed"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
              : doc.status === "processing"
              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
          )}>
            {doc.status}
          </Badge>
          {(doc.ocrJob?.status === "failed" || doc.status === "failed") && (
            <div className="mt-2 max-w-[260px]" data-testid={`ocr-failed-${doc.id}`}>
              <p className="text-xs text-red-700" role="status">
                OCR failed: {doc.ocrJob?.errorMessage ?? "Extraction failed"}
              </p>
              <Button size="sm" variant="outline" className="mt-1 gap-1"
                disabled={retryMutation.isPending || doc.status !== "failed"}
                onClick={() => retryMutation.mutate()} data-testid={`ocr-retry-${doc.id}`}>
                <RefreshCw className={cn("h-3 w-3", retryMutation.isPending && "animate-spin")} />
                {retryMutation.isPending ? "Retrying…" : "Retry"}
              </Button>
            </div>
          )}
        </td>

        {/* Uploaded */}
        <td className="px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                    onClick={() => reclassifyMutation.mutate()}
                    disabled={reclassifyMutation.isPending}
                  >
                    {reclassifyMutation.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Re-classify with AI</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                    data-testid={`document-view-${doc.id}`}
                    onClick={() => onView(doc.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">View document</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                    onClick={() => onDownload(doc.id)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Download</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </td>
      </tr>

      {/* ── Expanded breakdown row ─────────────────────────────────────────── */}
      {expanded && hasBreakdown && (
        <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30">
          <td colSpan={7} className="px-10 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
              {/* All-scores chart */}
              {doc.allClassificationScores && Object.keys(doc.allClassificationScores).length > 0 && (
                <div className="flex-1 min-w-0">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    All Type Scores
                  </p>
                  <AllScoresRow scores={doc.allClassificationScores} />
                </div>
              )}

              {/* Signals */}
              {doc.aiClassificationSignals && doc.aiClassificationSignals.length > 0 && (
                <div className="sm:max-w-xs">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Matched Signals
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.aiClassificationSignals.map((s, i) => (
                      <span key={i} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {s}
                      </span>
                    ))}
                  </div>
                  {doc.aiClassificationModel && (
                    <p className="mt-2 text-[10px] text-slate-400">Engine: {doc.aiClassificationModel}</p>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Documents() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryDocumentId = new URLSearchParams(queryString).get("documentId");
  const requestedDocumentId = queryDocumentId && /^\d+$/.test(queryDocumentId) ? Number(queryDocumentId) : null;
  const handledFocusId = useRef<number | null>(null);
  const pendingFocusId = useRef<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [srcFilter,  setSrcFilter]  = useState("all");
  const [confFilter, setConfFilter] = useState("all");

  const { data: documents = [], isLoading } = useQuery<AIDocument[]>({
    queryKey: ["/api/documents"],
    refetchInterval: 5000,
  });

  // ── Batch re-classify all docs that have no AI result yet ──────────────────
  const batchMutation = useMutation({
    mutationFn: async () => {
      const pending = documents.filter(d => !d.aiClassificationModel && d.status === "processed");
      await Promise.allSettled(
        pending.map(d => apiRequest("POST", `/api/load-documents/${d.id}/ai-classify`, {}))
      );
    },
    onSuccess: () => {
      toast({ title: "Batch complete", description: "All documents re-classified." });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });

  // ── View / Download ────────────────────────────────────────────────────────
  const handleView = (id: number) => {
    window.open(`/api/documents/${id}/view`, "_blank", "noopener,noreferrer");
  };

  const handleDownload = async (id: number) => {
    try {
      const r = await fetch(`/api/documents/${id}/download`, { credentials: "include" });
      if (!r.ok) throw new Error();
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(await r.blob()),
        download: `document_${id}`,
      });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast({ title: "Downloaded" });
    } catch {
      toast({ title: "Error", description: "Download failed.", variant: "destructive" });
    }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total         = documents.length;
  const aiCount       = documents.filter(d => d.classificationSource === "ai").length;
  const rulesCount    = documents.filter(d => d.classificationSource === "rules" || !d.classificationSource).length;
  const agentCount    = documents.filter(d => d.classificationSource === "agent").length;
  const lowConf       = documents.filter(d => {
    const c = d.classificationConfidence ? parseFloat(d.classificationConfidence) : null;
    return c !== null && c < 0.6;
  }).length;

  // ── Filtered docs ──────────────────────────────────────────────────────────
  const filtered = documents.filter(doc => {
    const displayType = documentClassification(doc);
    const conf        = doc.classificationConfidence ? parseFloat(doc.classificationConfidence) : null;
    const src         = doc.classificationSource ?? "rules";

    if (search && !doc.originalName.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== "all" && displayType !== typeFilter) return false;
    if (srcFilter  !== "all" && src !== srcFilter) return false;
    if (confFilter === "high"   && (conf === null || conf <  0.8))  return false;
    if (confFilter === "medium" && (conf === null || conf >= 0.8 || conf < 0.6)) return false;
    if (confFilter === "low"    && (conf === null || conf >= 0.6))  return false;
    return true;
  });

  useEffect(() => {
    if (requestedDocumentId === null || isLoading || handledFocusId.current === requestedDocumentId) return;
    if (!documents.some(doc => doc.id === requestedDocumentId)) return;
    handledFocusId.current = requestedDocumentId;
    pendingFocusId.current = requestedDocumentId;
    setSearch("");
    setTypeFilter("all");
    setSrcFilter("all");
    setConfFilter("all");
  }, [requestedDocumentId, documents, isLoading]);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null || isLoading || !filtered.some(doc => doc.id === id)) return;
    const row = document.getElementById(`document-row-${id}`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.focus({ preventScroll: true });
    pendingFocusId.current = null;
  }, [filtered, isLoading]);

  const clearDocumentFocus = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSearch("");
    setTypeFilter("all");
    setSrcFilter("all");
    setConfFilter("all");
    navigate("/documents");
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Documents"
          subtitle="AI-powered classification center"
          group="Workspace"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-6">
            {requestedDocumentId !== null && (
              <div data-testid="document-focus-notice" className="flex flex-wrap items-center justify-between gap-2 border-2 border-[#808080] border-b-white border-r-white bg-[#ece9e2] px-3 py-2 text-xs">
                <span>Focused document #{requestedDocumentId}. If OCR failed, its existing Retry action is in view.</span>
                <a href="/documents" onClick={clearDocumentFocus} data-testid="documents-show-all" className="font-semibold text-[#087c8d] underline underline-offset-2">Show all documents</a>
              </div>
            )}

            {/* ── Stats row ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                { label: "Total Documents",    value: total,      icon: <FileText className="h-4 w-4" />,    color: "text-slate-600 dark:text-slate-300",   bg: "bg-slate-100 dark:bg-slate-800" },
                { label: "AI Classified",       value: aiCount,    icon: <Sparkles className="h-4 w-4" />,    color: "text-purple-600 dark:text-purple-400",  bg: "bg-purple-50 dark:bg-purple-950/40" },
                { label: "Rules Engine",        value: rulesCount, icon: <BookOpen className="h-4 w-4" />,    color: "text-slate-600 dark:text-slate-300",   bg: "bg-slate-100 dark:bg-slate-800" },
                { label: "Agent Overrides",     value: agentCount, icon: <UserCheck className="h-4 w-4" />,  color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
                { label: "Low Confidence",      value: lowConf,    icon: <AlertTriangle className="h-4 w-4" />, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
              ].map(s => (
                <div key={s.label} className="ff-dashboard-card p-4">
                  <div className={cn("mb-2 flex h-8 w-8 items-center justify-center rounded-lg", s.bg, s.color)}>
                    {s.icon}
                  </div>
                  <p className="ff-stat-value text-2xl tracking-tight">{s.value}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>

            {/* ── Toolbar ────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  placeholder="Search by filename…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9 w-44 text-sm">
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="rate_confirmation">Rate Confirmation</SelectItem>
                  <SelectItem value="bill_of_lading">Bill of Lading</SelectItem>
                  <SelectItem value="proof_of_delivery">Proof of Delivery</SelectItem>
                  <SelectItem value="lumper_receipt">Lumper Receipt</SelectItem>
                  <SelectItem value="invoice">Invoice</SelectItem>
                  <SelectItem value="receipt">Receipt</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>

              <Select value={srcFilter} onValueChange={setSrcFilter}>
                <SelectTrigger className="h-9 w-36 text-sm">
                  <Brain className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="ai">AI only</SelectItem>
                  <SelectItem value="rules">Rules only</SelectItem>
                  <SelectItem value="agent">Agent only</SelectItem>
                </SelectContent>
              </Select>

              <Select value={confFilter} onValueChange={setConfFilter}>
                <SelectTrigger className="h-9 w-40 text-sm">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                  <SelectValue placeholder="All confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All confidence</SelectItem>
                  <SelectItem value="high">High (≥80%)</SelectItem>
                  <SelectItem value="medium">Medium (60–80%)</SelectItem>
                  <SelectItem value="low">Low (&lt;60%)</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-sm ml-auto"
                onClick={() => batchMutation.mutate()}
                disabled={batchMutation.isPending}
              >
                {batchMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5 text-purple-500" />}
                Re-classify all
              </Button>
            </div>

            {/* ── Table ──────────────────────────────────────────────────── */}
            <div className="ff-card ff-table-container overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading documents…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                    <FileQuestion className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                    {documents.length === 0 ? "No documents uploaded yet" : "No documents match your filters"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {documents.length === 0
                      ? "Upload documents through an invoice to see AI classification here."
                      : "Try adjusting the search or filters above."}
                  </p>
                </div>
              ) : (
                <table className="ff-data-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Document
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Classification
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Confidence
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Source
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Uploaded
                      </th>
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(doc => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        onView={handleView}
                        onDownload={handleDownload}
                        focusTargetId={requestedDocumentId}
                      />
                    ))}
                  </tbody>
                </table>
              )}

              {/* Footer count */}
              {!isLoading && filtered.length > 0 && (
                <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 text-[11px] text-slate-400">
                  Showing {filtered.length} of {documents.length} document{documents.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}

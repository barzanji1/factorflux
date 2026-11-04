import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileQuestion,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  UserCheck,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useServerArrayPage } from "@/hooks/use-server-array-page";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import type { Document } from "@shared/schema";
import { CompressionInfo } from "@/components/documents/compression-info";
import { DocumentsOverview } from "@/components/documents/documents-overview";
import EntityNotes from "@/components/shared/EntityNotes";
import { documentClassification, documentClassificationLabel } from "@shared/document-display";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
  NeuPageShell,
  NeuSelect,
  NeuTable,
  NeuTableBody,
  NeuTableCell,
  NeuTableHead,
  NeuTableHeader,
  NeuTableRow,
} from "@/styles/neu/components";

interface AIDocument extends Omit<Document, "aiClassifiedAt"> {
  ocrJob?: { id: number; status: string; errorMessage: string | null; parserName: string | null } | null;
  aiDocumentType: string | null;
  aiClassificationConfidence: string | null;
  aiClassificationSignals: string[] | null;
  allClassificationScores: Record<string, number> | null;
  classificationSource: "rules" | "ai" | "agent" | null;
  aiClassifiedAt: string | null;
  aiClassificationModel: string | null;
  invoiceNumber?: string | null;
  carrierName?: string | null;
  carrierId?: number | null;
  ocrConfidence: number | null;
  processingState?: "pending" | "processing" | "processed" | "failed";
}

interface ExtractionSummary {
  textPreview: string;
  confidence: number | null;
  fields: Array<{ name: string; value: string; confidence: number | null }>;
}

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const TYPE_OPTIONS = [
  ["all", "All classifications"],
  ["rate_confirmation", "Rate Confirmation"],
  ["invoice", "Freight Invoice"],
  ["freight_invoice", "Freight Invoice (legacy)"],
  ["commercial_invoice", "Commercial Invoice"],
  ["bill_of_lading", "Bill of Lading"],
  ["bol", "Bill of Lading (legacy)"],
  ["proof_of_delivery", "Proof of Delivery"],
  ["pod", "Proof of Delivery (legacy)"],
  ["lumper_receipt", "Lumper Receipt"],
  ["receipt", "Receipt"],
  ["driver_id", "Driver ID"],
  ["carrier_setup", "Carrier Setup"],
  ["noa", "Notice of Assignment"],
  ["release_letter", "Release Letter"],
  ["other", "Other"],
] as const;

async function fetchAllDocuments(params: Record<string, string> = {}) {
  const all: AIDocument[] = [];
  let total = 0;
  let pages = 1;
  for (let page = 1; page <= pages; page += 1) {
    const url = new URL("/api/documents", window.location.origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_SIZE));
    const response = await fetch(url.toString(), { credentials: "include" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || `Could not load documents (HTTP ${response.status}).`);
    }
    const result: unknown = await response.json();
    if (!Array.isArray(result)) throw new Error("The documents endpoint returned an unexpected response.");
    all.push(...result as AIDocument[]);
    const countHeader = response.headers.get("X-Total-Count");
    const headerTotal = countHeader === null ? Number.NaN : Number(countHeader);
    total = Number.isFinite(headerTotal) && headerTotal >= 0 ? headerTotal : all.length;
    pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  }
  return all;
}

function typeLabel(type: string | null | undefined) {
  return type ? documentClassificationLabel(type) : "Unclassified";
}

function dateValue(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function parseConfidence(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function documentConfidence(doc: AIDocument) {
  return doc.ocrConfidence !== undefined
    ? parseConfidence(doc.ocrConfidence)
    : parseConfidence(doc.classificationConfidence);
}

function ConfidenceBar({ score }: { score: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(score * 100)));
  const color = score >= 0.8 ? "bg-[#347d69]" : score >= 0.6 ? "bg-[#b27a2b]" : "bg-[#ad5c50]";
  return (
    <div className="flex min-w-[110px] items-center gap-2" aria-label={`Confidence ${percent}%`}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#c8c8c8]">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-xs font-semibold text-[#526164]">{percent}%</span>
    </div>
  );
}

function SourceBadge({ source, model }: { source: string | null; model?: string | null }) {
  const tone = source === "agent" ? "success" : source === "ai" ? "accent" : "neutral";
  const Icon = source === "agent" ? UserCheck : source === "ai" ? Sparkles : BookOpen;
  const label = source === "agent" ? "Agent" : source === "ai" ? "AI" : "Rules";
  return (
    <span title={source === "ai" ? model ?? "AI classification" : undefined}>
      <NeuBadge tone={tone} className="gap-1 whitespace-nowrap"><Icon className="h-3 w-3" />{label}</NeuBadge>
    </span>
  );
}

function Scores({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores).sort(([, a], [, b]) => b - a);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([name, score]) => (
        <div key={name} className="grid grid-cols-[minmax(100px,1fr)_2fr_42px] items-center gap-2 text-xs">
          <span className="truncate text-[#647275]">{typeLabel(name)}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#c7c7c7]">
            <div className="h-full rounded-full bg-[#27aab8]" style={{ width: `${Math.max(0, Math.min(100, score * 100))}%` }} />
          </div>
          <span className="text-right font-mono text-[#59696b]">{Math.round(score * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function ExtractionDetails({ doc }: { doc: AIDocument }) {
  const { data, isLoading, isError, refetch } = useQuery<ExtractionSummary>({
    queryKey: ["/api/documents", doc.id, "extraction-summary"],
    enabled: true,
    queryFn: async () => {
      const response = await fetch(`/api/documents/${doc.id}/extraction-summary`, { credentials: "include" });
      if (!response.ok) throw new Error("Extraction summary could not be loaded");
      return response.json();
    },
  });
  const fields = useMemo(() => {
    const recognized: Array<{ label: string; aliases: string[] }> = [
      { label: "Invoice number", aliases: ["invoicenumber"] },
      { label: "Load number", aliases: ["loadnumber", "loadid"] },
      { label: "Amount", aliases: ["amount", "invoiceamount", "total"] },
      { label: "Broker", aliases: ["brokername"] },
    ];
    const normalized = (data?.fields ?? []).map(field => ({
      field,
      key: field.name.replace(/[^a-z0-9]/gi, "").toLowerCase(),
    }));
    const mapped = recognized.flatMap(({ label, aliases }) => {
      const found = normalized.find(item => aliases.includes(item.key));
      return found ? [{ label, field: found.field, key: found.key }] : [];
    });
    const mappedKeys = new Set(mapped.map(item => item.key));
    const generic = normalized
      .filter(item => !mappedKeys.has(item.key))
      .map(({ field, key }) => ({
        label: field.name.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()),
        field,
        key,
      }));
    return [...mapped, ...generic];
  }, [data?.fields]);
  const confidence = data?.confidence ?? null;
  const tone = confidence === null ? "neutral" : confidence >= 0.8 ? "success" : confidence >= 0.6 ? "warning" : "neutral";
  const confidenceLabel = confidence === null
    ? "Unavailable"
    : `${confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : "Low"} · ${Math.round(confidence * 100)}%`;

  return (
    <NeuCard className="my-3 whitespace-normal p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c898a]">Document extraction</p>
          <h3 className="mt-1 break-all text-sm font-semibold text-[#354548]">{doc.originalName}</h3>
        </div>
        <NeuBadge tone={tone}>OCR confidence: {confidenceLabel}</NeuBadge>
      </div>
      {isLoading ? (
        <div className="mt-4 space-y-2" aria-label="Loading extraction summary">
          <div className="h-3 w-4/5 animate-pulse rounded bg-[#c9c9c9]" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-[#c9c9c9]" />
        </div>
      ) : isError ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#dedede] p-3">
          <p className="text-sm text-[#80544b]">Extraction details could not be loaded.</p>
          <NeuButton onClick={() => refetch()} className="min-h-10 px-3 text-xs"><RefreshCw className="h-3.5 w-3.5" />Retry details</NeuButton>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <section>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#7c898a]">OCR preview</h4>
              <p className="min-h-16 whitespace-pre-wrap break-words rounded-xl bg-[#dedede] p-3 text-xs leading-5 text-[#526164]">
                {data?.textPreview || "No OCR text was returned."}
              </p>
            </section>
            <section>
              <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[#7c898a]">Recognized fields</h4>
              <dl className="grid grid-cols-2 gap-2">
                {fields.map(({ label, field }) => (
                  <div key={label} className="min-w-0 rounded-xl bg-[#dedede] p-3">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#859092]">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-medium text-[#354548]">{field?.value || "Unavailable"}</dd>
                    <dd className="mt-2">
                      <NeuBadge
                        tone={field?.confidence == null ? "neutral" : field.confidence >= .8 ? "success" : field.confidence >= .6 ? "warning" : "neutral"}
                        className={cn("text-[10px]", field?.confidence != null && field.confidence < .6 && "bg-red-100 text-red-700")}
                      >
                        {field?.confidence == null ? "Confidence unavailable" : `${field.confidence >= .8 ? "High" : field.confidence >= .6 ? "Medium" : "Low"} · ${Math.round(field.confidence * 100)}%`}
                      </NeuBadge>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          {doc.invoiceId && (
            <Link href={`/invoices/${doc.invoiceId}`} className="mt-3 inline-flex text-xs font-semibold text-[#168d98] underline underline-offset-2">
              Open linked invoice {doc.invoiceNumber ? `#${doc.invoiceNumber}` : `#${doc.invoiceId}`}
            </Link>
          )}
        </>
      )}
      {(doc.allClassificationScores || doc.aiClassificationSignals?.length || doc.aiClassificationModel) && (
        <div className="mt-5 border-t border-[#c5c5c5] pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#7c898a]">Classification evidence</h4>
            {doc.aiClassificationModel && <span className="text-xs text-[#718083]">Model: {doc.aiClassificationModel}</span>}
          </div>
          {doc.allClassificationScores && <Scores scores={doc.allClassificationScores} />}
          {!!doc.aiClassificationSignals?.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {doc.aiClassificationSignals.map((signal, index) => <NeuBadge key={`${signal}-${index}`}>{signal}</NeuBadge>)}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 border-t border-[#c5c5c5] pt-3">
        <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
      </div>
    </NeuCard>
  );
}

function DocumentRow({ doc, focusTargetId, onView, onDownload }: {
  doc: AIDocument;
  focusTargetId: number | null;
  onView: (id: number) => void;
  onDownload: (id: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const displayType = documentClassification(doc);
  const confidence = documentConfidence(doc);
  const source = doc.classificationSource ?? "rules";
  const processingState = doc.processingState ?? doc.status;
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
  const statusTone = processingState === "processed" ? "success" : processingState === "failed" ? "warning" : "neutral";
  const invoiceHref = doc.invoiceId ? `/invoices/${doc.invoiceId}` : null;
  const carrierHref = doc.carrierId ? `/carriers/${doc.carrierId}` : null;

  return (
    <>
      <NeuTableRow
        id={`document-row-${doc.id}`}
        data-testid={`document-row-${doc.id}`}
        tabIndex={-1}
        className={cn("focus:outline focus:outline-2 focus:outline-[#168d98]", focusTargetId === doc.id && "bg-[#cfe4e3] outline outline-2 outline-[#168d98]")}
      >
        <NeuTableCell className="max-w-[300px]">
          <div className="flex min-w-0 items-start gap-2">
            <NeuButton
              onClick={() => setExpanded(value => !value)}
              aria-label={`${expanded ? "Collapse" : "Expand"} extraction details for ${doc.originalName}`}
              aria-expanded={expanded}
              className="h-9 min-h-9 w-9 shrink-0 rounded-lg p-0"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </NeuButton>
            <FileText className="mt-2 h-4 w-4 shrink-0 text-[#718083]" />
            <div className="min-w-0">
              <p className="break-all text-sm font-semibold text-[#354548]" title={doc.originalName}>{doc.originalName}</p>
              <p className="mt-1 text-[11px] text-[#7c898a]">
                {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : "Size unavailable"}
              </p>
              <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
            </div>
          </div>
        </NeuTableCell>
        <NeuTableCell>
          <div className="flex flex-col items-start gap-1.5">
              <NeuBadge className={cn(
                displayType === "rate_confirmation" && "bg-blue-100 text-blue-800",
                ["invoice", "freight_invoice", "carrier_invoice", "commercial_invoice"].includes(displayType) && "bg-violet-100 text-violet-800",
                ["bol", "bol_pod", "bill_of_lading", "pod", "proof_of_delivery"].includes(displayType) && "bg-emerald-100 text-emerald-800",
                displayType === "noa" && "bg-amber-100 text-amber-800",
              )}>{typeLabel(displayType)}</NeuBadge>
            <SourceBadge source={source} model={doc.aiClassificationModel} />
          </div>
        </NeuTableCell>
        <NeuTableCell>{confidence === null ? <span className="text-xs text-[#899394]">Unavailable</span> : <ConfidenceBar score={confidence} />}</NeuTableCell>
        <NeuTableCell>
          <div className="flex min-w-[120px] flex-col gap-1 text-xs">
            {invoiceHref ? <Link href={invoiceHref} className="font-semibold text-[#168d98] underline underline-offset-2">{doc.invoiceNumber ? `Invoice ${doc.invoiceNumber}` : `Invoice #${doc.invoiceId}`}</Link> : <span className="text-[#879294]">No linked invoice</span>}
            {carrierHref ? <Link href={carrierHref} className="text-[#536467] underline decoration-[#aab5b5] underline-offset-2">{doc.carrierName || `Carrier #${doc.carrierId}`}</Link> : doc.carrierName ? <span className="text-[#536467]">{doc.carrierName}</span> : null}
          </div>
        </NeuTableCell>
        <NeuTableCell>
          <div className="flex min-w-[145px] flex-col items-start gap-2">
            <NeuBadge tone={processingState === "processing" ? "warning" : statusTone} className={cn(processingState === "failed" && "bg-red-100 text-red-700")}>{processingState}</NeuBadge>
            {processingState === "failed" && (
              <div data-testid={`ocr-failed-${doc.id}`} className="max-w-[260px]">
                <p className="text-xs leading-4 text-[#9d5149]" role="status">OCR failed: {doc.ocrJob?.errorMessage ?? "Extraction failed"}</p>
                <NeuButton
                  className="mt-2 min-h-9 rounded-lg px-3 text-xs"
                  disabled={retryMutation.isPending || doc.status !== "failed"}
                  onClick={() => retryMutation.mutate()}
                  data-testid={`ocr-retry-${doc.id}`}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", retryMutation.isPending && "animate-spin")} />
                  {retryMutation.isPending ? "Retrying" : "Retry OCR"}
                </NeuButton>
              </div>
            )}
          </div>
        </NeuTableCell>
        <NeuTableCell className="whitespace-nowrap text-xs text-[#667679]">{dateValue(doc.createdAt) || "Unavailable"}</NeuTableCell>
        <NeuTableCell>
          <div className="flex flex-wrap items-center gap-1.5">
            <NeuButton
              onClick={() => onView(doc.id)}
              data-testid={`document-view-${doc.id}`}
              aria-label={`View ${doc.originalName}`}
              className="h-10 min-h-10 rounded-lg px-3 text-xs"
            ><Eye className="h-4 w-4" /><span className="sr-only sm:not-sr-only">View</span></NeuButton>
            <NeuButton
              onClick={() => onDownload(doc.id)}
              aria-label={`Download ${doc.originalName}`}
              className="h-10 min-h-10 rounded-lg px-3 text-xs"
            ><Download className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Download</span></NeuButton>
            <NeuButton
              onClick={() => reclassifyMutation.mutate()}
              disabled={reclassifyMutation.isPending}
              aria-label={`Reclassify ${doc.originalName}`}
              className="h-10 min-h-10 rounded-lg px-3 text-xs"
            >
              {reclassifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="sr-only sm:not-sr-only">Reclassify</span>
            </NeuButton>
          </div>
        </NeuTableCell>
      </NeuTableRow>
      {expanded && (
        <tr className="bg-[#d9d9d9]">
          <td colSpan={7} className="px-3 sm:px-5">
            <ExtractionDetails doc={doc} />
            <EntityNotes key={`document:${doc.id}`} entityType="document" entityId={doc.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Documents() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const requestedValue = new URLSearchParams(queryString).get("documentId");
  const requestedDocumentId = requestedValue && /^\d+$/.test(requestedValue) ? Number(requestedValue) : null;
  const handledFocusId = useRef<number | null>(null);
  const pendingFocusId = useRef<number | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [srcFilter, setSrcFilter] = useState("all");
  const [confFilter, setConfFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [resolvedFocusId, setResolvedFocusId] = useState<number | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");
  const filterParams = useMemo<Record<string, string>>(() => {
    const params: Record<string, string> = {};
    if (search.trim()) params.q = search.trim();
    if (typeFilter !== "all") {
      const matchingTypes: Record<string, string[]> = {
        invoice: ["invoice", "freight_invoice"],
        freight_invoice: ["invoice", "freight_invoice"],
        bill_of_lading: ["bill_of_lading", "bol"],
        bol: ["bill_of_lading", "bol"],
        proof_of_delivery: ["proof_of_delivery", "pod"],
        pod: ["proof_of_delivery", "pod"],
      };
      params.type = (matchingTypes[typeFilter] ?? [typeFilter]).join(",");
    }
    if (srcFilter !== "all") params.source = srcFilter;
    if (statusFilter !== "all") params.status = statusFilter;
    if (confFilter !== "all") params.confidence = confFilter;
    if (fromDate) {
      const date = new Date(`${fromDate}T00:00:00`);
      if (!Number.isNaN(date.getTime())) params.from = date.toISOString();
    }
    if (toDate) {
      const date = new Date(`${toDate}T23:59:59.999`);
      if (!Number.isNaN(date.getTime())) params.to = date.toISOString();
    }
    return params;
  }, [search, typeFilter, srcFilter, statusFilter, confFilter, fromDate, toDate]);
  const queryParams = useMemo(() => (
    requestedDocumentId !== null && resolvedFocusId !== requestedDocumentId
      ? { ...filterParams, focusId: String(requestedDocumentId) }
      : filterParams
  ), [filterParams, requestedDocumentId, resolvedFocusId]);
  const {
    items: documents,
    total: totalDocuments,
    page: currentPage,
    pageCount: totalPages,
    pageSize,
    resolvedPage,
    isLoading,
    isFetching,
    isError,
    refetch,
    setPage,
  } = useServerArrayPage<AIDocument>("/api/documents", {
    params: queryParams,
    resetKey: JSON.stringify(filterParams),
    refetchInterval: 5000,
  });

  const batchMutation = useMutation({
    mutationFn: async () => {
      const allDocuments = await fetchAllDocuments();
      const pending = allDocuments.filter(doc => !doc.aiClassificationModel && doc.status === "processed");
      await Promise.allSettled(pending.map(doc => apiRequest("POST", `/api/load-documents/${doc.id}/ai-classify`, {})));
      return pending.length;
    },
    onSuccess: (count) => {
      toast({ title: "Batch complete", description: count ? `${count} eligible document(s) queued for re-classification.` : "No eligible documents required re-classification." });
      qc.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });

  const handleView = (id: number) => {
    window.open(`/api/documents/${id}/view`, "_blank", "noopener,noreferrer");
  };

  const handleDownload = (id: number) => {
    const anchor = Object.assign(document.createElement("a"), {
      href: `/api/documents/${id}/download`,
      rel: "noopener noreferrer",
    });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const pageDocuments = documents;

  useEffect(() => {
    handledFocusId.current = null;
    pendingFocusId.current = null;
    setResolvedFocusId(null);
  }, [requestedDocumentId]);

  useEffect(() => {
    // Only the initial deep-link lookup may override navigation. A previous
    // page's metadata must never cancel a user's Next/Previous click.
    if (requestedDocumentId !== null && resolvedFocusId !== requestedDocumentId && !isFetching &&
      resolvedPage !== null && resolvedPage !== currentPage) setPage(resolvedPage);
  }, [requestedDocumentId, resolvedFocusId, isFetching, resolvedPage, currentPage, setPage]);

  useEffect(() => {
    if (requestedDocumentId === null || isLoading || handledFocusId.current === requestedDocumentId) return;
    if (resolvedPage !== null && resolvedPage !== currentPage) return;
    const target = documents.find(doc => doc.id === requestedDocumentId);
    if (!target) {
      if (resolvedPage !== null && resolvedPage === currentPage) setResolvedFocusId(requestedDocumentId);
      return;
    }
    handledFocusId.current = requestedDocumentId;
    pendingFocusId.current = requestedDocumentId;
    setResolvedFocusId(requestedDocumentId);
    setSearch("");
    setTypeFilter("all");
    setSrcFilter("all");
    setConfFilter("all");
    setStatusFilter("all");
    setFromDate("");
    setToDate("");
    setPage(resolvedPage ?? currentPage);
  }, [requestedDocumentId, documents, isLoading, resolvedPage, currentPage, setPage]);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null || isLoading || !pageDocuments.some(doc => doc.id === id)) return;
    const row = document.getElementById(`document-row-${id}`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.focus({ preventScroll: true });
    pendingFocusId.current = null;
  }, [pageDocuments, isLoading]);

  const clearDocumentFocus = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSearch("");
    setTypeFilter("all");
    setSrcFilter("all");
    setConfFilter("all");
    setStatusFilter("all");
    setFromDate("");
    setToDate("");
    setPage(1);
    navigate("/documents");
  };

  const exportCsv = async () => {
    if (exportLoading) return;
    setExportLoading(true);
    setExportError("");
    try {
      const exportDocuments = await fetchAllDocuments(filterParams);
      const headers = ["Filename", "Classification", "Invoice number", "Carrier", "Confidence", "Processing state", "Uploaded"];
      const cell = (value: unknown) => {
        let text = String(value ?? "");
        if (/^[\u0000-\u0020]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const rows = exportDocuments.map(doc => [
        doc.originalName,
        typeLabel(documentClassification(doc)),
        doc.invoiceNumber ?? (doc.invoiceId ? String(doc.invoiceId) : ""),
        doc.carrierName ?? "",
        documentConfidence(doc) === null ? "" : `${Math.round(documentConfidence(doc)! * 100)}%`,
        doc.processingState ?? doc.status,
        doc.createdAt ?? "",
      ]);
      const csv = [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const anchor = Object.assign(document.createElement("a"), { href: url, download: "factorflux-documents.csv" });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export documents.");
    } finally {
      setExportLoading(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setSrcFilter("all");
    setConfFilter("all");
    setStatusFilter("all");
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Document Work Queue" subtitle="Paperwork integrity · OCR exceptions · classification review" group="Workspace" neu />
        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-7 xl:p-9">
            {requestedDocumentId !== null && (
              <NeuCard data-testid="document-focus-notice" className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="text-xs text-[#526164]">Focused document #{requestedDocumentId}. OCR exceptions and retry controls are available in its row.</span>
                <a href="/documents" onClick={clearDocumentFocus} data-testid="documents-show-all" className="text-xs font-semibold text-[#168d98] underline underline-offset-2">Show all documents</a>
              </NeuCard>
            )}
            <DocumentsOverview />

            <NeuCard className="p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#758587]">Document register</p>
                  <h2 className="mt-1 text-lg font-semibold text-[#354548]">Review incoming paperwork</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <NeuButton onClick={() => void exportCsv()} disabled={totalDocuments === 0 || exportLoading} className="min-h-10 px-3 text-xs">
                    {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {exportLoading ? "Preparing CSV" : "Export CSV"}
                  </NeuButton>
                  <NeuButton
                    onClick={() => batchMutation.mutate()}
                    disabled={batchMutation.isPending || totalDocuments === 0}
                    variant="accent"
                    className="min-h-10 px-3 text-xs"
                  >
                    {batchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Reclassify eligible
                  </NeuButton>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="relative sm:col-span-2">
                  <span className="sr-only">Search filename, invoice number, or carrier</span>
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788b8d]" />
                  <NeuInput placeholder="Filename, invoice number, or carrier…" value={search} onChange={event => setSearch(event.target.value)} className="pl-11" data-testid="input-search-documents" />
                </label>
                <label>
                  <span className="sr-only">Classification type</span>
                  <NeuSelect value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Classification type">
                    {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </NeuSelect>
                </label>
                <label>
                  <span className="sr-only">Classification source</span>
                  <NeuSelect value={srcFilter} onChange={event => setSrcFilter(event.target.value)} aria-label="Classification source">
                    <option value="all">All sources</option><option value="ai">AI only</option><option value="rules">Rules only</option><option value="agent">Agent only</option>
                  </NeuSelect>
                </label>
                <label>
                  <span className="sr-only">Processing status</span>
                  <NeuSelect value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Processing status">
                    <option value="all">All processing states</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="processed">Processed</option><option value="failed">Failed OCR</option>
                  </NeuSelect>
                </label>
                <label>
                  <span className="sr-only">OCR confidence</span>
                  <NeuSelect value={confFilter} onChange={event => setConfFilter(event.target.value)} aria-label="OCR confidence">
                    <option value="all">All confidence</option><option value="high">High · 80% and above</option><option value="medium">Medium · 60–79%</option><option value="low">Low · below 60%</option>
                  </NeuSelect>
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-[#e0e0e0] px-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#788b8d]">From</span>
                  <NeuInput type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} aria-label="Uploaded from date" className="min-h-10 px-1 shadow-none" />
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-[#e0e0e0] px-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[#788b8d]">To</span>
                  <NeuInput type="date" value={toDate} onChange={event => setToDate(event.target.value)} aria-label="Uploaded to date" className="min-h-10 px-1 shadow-none" />
                </label>
                <div className="flex flex-wrap items-center gap-2 xl:col-span-4">
                  <span className="text-xs text-[#758587]">{totalDocuments.toLocaleString()} matching documents</span>
                  <NeuButton onClick={clearFilters} className="min-h-9 rounded-lg px-3 text-xs">Clear filters</NeuButton>
                </div>
              </div>
              {exportError && <p role="alert" className="mt-3 text-xs text-[#ad5c50]">{exportError}</p>}
            </NeuCard>

            <NeuCard className="min-h-0 overflow-hidden p-3 sm:p-5">
              {isLoading ? (
                <div className="space-y-3 p-3" aria-label="Loading documents">
                  {[1, 2, 3, 4, 5].map(row => <div key={row} className="flex animate-pulse items-center gap-4"><div className="h-9 w-9 rounded-lg bg-[#c9c9c9]" /><div className="h-4 flex-1 rounded bg-[#c9c9c9]" /><div className="h-4 w-1/5 rounded bg-[#c9c9c9]" /></div>)}
                </div>
              ) : isError ? (
                <div className="flex flex-col items-center py-14 text-center">
                  <AlertTriangle className="mb-3 h-8 w-8 text-[#ad5c50]" />
                  <p className="font-semibold text-[#354548]">Documents did not load</p>
                  <p className="mt-1 text-sm text-[#758587]">The queue could not be refreshed. Try again.</p>
                  <NeuButton onClick={() => refetch()} className="mt-4 min-h-10 px-4 text-xs"><RefreshCw className="h-4 w-4" />Retry loading</NeuButton>
                </div>
              ) : documents.length === 0 ? (
                <div className="flex flex-col items-center py-14 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#d9d9d9]"><FileQuestion className="h-6 w-6 text-[#788b8d]" /></div>
                  <p className="font-semibold text-[#354548]">{totalDocuments === 0 && Object.keys(filterParams).length === 0 ? "No documents in the queue" : "No documents match these filters"}</p>
                  <p className="mt-1 max-w-md text-sm text-[#758587]">{totalDocuments === 0 && Object.keys(filterParams).length === 0 ? "Documents attached to invoices appear here for OCR and classification review." : "Adjust search, date, status, or confidence filters to widen the queue."}</p>
                  {Object.keys(filterParams).length > 0 && <NeuButton onClick={clearFilters} className="mt-4 min-h-10 px-4 text-xs">Clear filters</NeuButton>}
                </div>
              ) : (
                <>
                  <NeuTable className="min-w-[1100px]">
                    <NeuTableHeader>
                      <tr>
                        {["Filename", "Classification", "Confidence", "Linked invoice / carrier", "Processing state", "Uploaded", "Actions"].map(title => <NeuTableHead key={title}>{title}</NeuTableHead>)}
                      </tr>
                    </NeuTableHeader>
                    <NeuTableBody>
                      {pageDocuments.map(doc => <DocumentRow key={doc.id} doc={doc} focusTargetId={requestedDocumentId} onView={handleView} onDownload={handleDownload} />)}
                    </NeuTableBody>
                  </NeuTable>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#c5c5c5] px-1 pt-3">
                    <span className="text-xs text-[#758587]">
                      Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalDocuments)} of {totalDocuments.toLocaleString()} matching documents
                    </span>
                    <div className="flex items-center gap-2">
                      <NeuButton onClick={() => setPage(value => Math.max(1, value - 1))} disabled={currentPage <= 1 || isFetching} className="min-h-10 px-3 text-xs">Previous</NeuButton>
                      <span className="px-2 text-xs text-[#758587]">Page {currentPage} of {totalPages}</span>
                      <NeuButton onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={currentPage >= totalPages || isFetching} className="min-h-10 px-3 text-xs">Next</NeuButton>
                    </div>
                  </div>
                </>
              )}
            </NeuCard>
          </div>
        </NeuPageShell>
      </div>
    </div>
  );
}

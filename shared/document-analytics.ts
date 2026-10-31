import { documentClassification, type DocumentClassification } from "./document-display";

export type DocumentProcessingState = "processed" | "pending" | "failed" | "processing";
export interface DocumentAnalyticsRow extends DocumentClassification {
  status: string;
  jobStatus?: string | null;
  ocrConfidence?: string | number | null;
  reviewStatus?: string | null;
  createdAt: string | Date | null;
}
export interface DocumentStats {
  total: number;
  pendingReview: number;
  processed: number;
  failedOcr: number;
  averageConfidence: number | null;
  unknownConfidence: number;
  types: { type: string; label: string; count: number }[];
  statuses: { status: DocumentProcessingState; label: string; count: number }[];
  confidence: { bucket: string; count: number }[];
  uploads: { month: string; count: number }[];
}

export function normalizeDocumentConfidence(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}
export function documentProcessingState(status: string, jobStatus?: string | null): DocumentProcessingState {
  if (jobStatus === "failed") return "failed";
  if (jobStatus === "queued") return "pending";
  if (jobStatus === "processing") return "processing";
  if (jobStatus === "completed") return "processed";
  if (status === "processed" || status === "failed" || status === "processing") return status;
  return "pending";
}
export function documentTypeBucket(doc: DocumentClassification): string {
  const type = documentClassification(doc);
  if (type === "rate_confirmation") return "rate_confirmation";
  if (["invoice", "carrier_invoice", "freight_invoice", "commercial_invoice"].includes(type)) return "freight_invoice";
  if (["bol", "bol_pod", "bill_of_lading", "pod", "proof_of_delivery"].includes(type)) return "bol_pod";
  if (type === "noa") return "noa";
  return "other";
}
function monthKey(date: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit" })
    .formatToParts(new Date(date));
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}
/** All statistics refer to the authorized document collection, not the current table page. */
export function buildDocumentStats(rows: DocumentAnalyticsRow[], now = new Date()): DocumentStats {
  const [year, month] = monthKey(now).split("-").map(Number);
  const uploads = Array.from({ length: 6 }, (_, index) => ({
    month: new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7), count: 0,
  }));
  const types = [
    { type: "rate_confirmation", label: "Rate Confirmation", count: 0 },
    { type: "freight_invoice", label: "Freight Invoice", count: 0 },
    { type: "bol_pod", label: "BOL/POD", count: 0 },
    { type: "noa", label: "NOA", count: 0 },
    { type: "other", label: "Other", count: 0 },
  ];
  const statuses: DocumentStats["statuses"] = [
    { status: "processed", label: "Processed", count: 0 }, { status: "pending", label: "Pending", count: 0 },
    { status: "failed", label: "Failed", count: 0 }, { status: "processing", label: "In Progress", count: 0 },
  ];
  const confidence = ["0–50%", "50–70%", "70–85%", "85–95%", "95–100%"].map(bucket => ({ bucket, count: 0 }));
  let sum = 0;
  let known = 0;
  let pendingReview = 0;
  let failedOcr = 0;
  for (const row of rows) {
    types.find(value => value.type === documentTypeBucket(row))!.count++;
    const state = documentProcessingState(row.status, row.jobStatus);
    statuses.find(value => value.status === state)!.count++;
    if (row.reviewStatus !== "confirmed") pendingReview++;
    if (state === "failed") failedOcr++;
    // Do not expose old confidence as the outcome of a new queued/failed OCR job.
    const score = ["failed", "pending", "processing"].includes(state) ? null : normalizeDocumentConfidence(row.ocrConfidence);
    if (score !== null) {
      sum += score;
      known++;
      const bucket = score < .5 ? 0 : score < .7 ? 1 : score < .85 ? 2 : score < .95 ? 3 : 4;
      confidence[bucket].count++;
    }
    if (row.createdAt && Number.isFinite(new Date(row.createdAt).getTime()) && new Date(row.createdAt) <= now) {
      const monthly = uploads.find(value => value.month === monthKey(row.createdAt!));
      if (monthly) monthly.count++;
    }
  }
  return {
    total: rows.length, pendingReview, processed: statuses[0].count, failedOcr,
    averageConfidence: known ? Math.round(sum / known * 10000) / 100 : null,
    unknownConfidence: rows.length - known, types, statuses, confidence, uploads,
  };
}

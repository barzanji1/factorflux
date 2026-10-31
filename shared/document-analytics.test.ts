import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentStats, documentProcessingState, documentTypeBucket, normalizeDocumentConfidence, type DocumentAnalyticsRow } from "./document-analytics";
const now = new Date("2026-10-30T18:00:00Z");
const document = (patch: Partial<DocumentAnalyticsRow> = {}): DocumentAnalyticsRow => ({
  status: "processed", documentType: "other", createdAt: now, ocrConfidence: null, ...patch,
});
test("empty collection has no invented OCR confidence and six empty upload months", () => {
  const stats = buildDocumentStats([], now);
  assert.equal(stats.total, 0);
  assert.equal(stats.averageConfidence, null);
  assert.equal(stats.uploads.length, 6);
  assert.equal(stats.uploads[0].month, "2026-05");
  assert.equal(stats.uploads[5].month, "2026-10");
});
test("classification grouping honors human overrides, AI precedence, and legacy aliases", () => {
  assert.equal(documentTypeBucket(document({ aiDocumentType: "rate_confirmation" })), "rate_confirmation");
  assert.equal(documentTypeBucket(document({ classificationSource: "agent", finalDocumentType: "other", aiDocumentType: "rate_confirmation" })), "other");
  for (const type of ["invoice", "freight_invoice", "carrier_invoice"]) assert.equal(documentTypeBucket(document({ aiDocumentType: type })), "freight_invoice");
  for (const type of ["bol", "pod", "bol_pod", "bill_of_lading", "proof_of_delivery"]) assert.equal(documentTypeBucket(document({ aiDocumentType: type })), "bol_pod");
  assert.equal(documentTypeBucket(document({ aiDocumentType: "noa" })), "noa");
});
test("latest job failure/queued/in-progress state cannot appear as a completed old document", () => {
  assert.equal(documentProcessingState("processed", "failed"), "failed");
  assert.equal(documentProcessingState("processed", "queued"), "pending");
  assert.equal(documentProcessingState("processed", "processing"), "processing");
  assert.equal(documentProcessingState("failed", "completed"), "processed");
  const stats = buildDocumentStats(["failed", "queued", "processing"].map(jobStatus => document({ jobStatus, ocrConfidence: .99 })), now);
  assert.equal(stats.averageConfidence, null);
  assert.equal(stats.failedOcr, 1);
  assert.equal(stats.statuses.reduce((sum, row) => sum + row.count, 0), stats.total);
});
test("OCR confidence is normalized, invalid or missing values remain unknown", () => {
  for (const input of [null, "", " ", undefined, "no", -1, 101, true, {}, []]) assert.equal(normalizeDocumentConfidence(input), null);
  assert.equal(normalizeDocumentConfidence("85"), .85);
  assert.equal(normalizeDocumentConfidence("0.85"), .85);
  assert.equal(normalizeDocumentConfidence(0), 0);
  assert.equal(normalizeDocumentConfidence(1), 1);
});
test("confidence buckets have non-overlapping boundaries including exact zero and one", () => {
  const stats = buildDocumentStats([0, .49, .5, .69, .7, .849, .85, .949, .95, 1].map(ocrConfidence => document({ ocrConfidence })), now);
  assert.deepEqual(stats.confidence.map(row => row.count), [2, 2, 2, 2, 2]);
  assert.equal(stats.unknownConfidence, 0);
  assert.equal(stats.confidence.reduce((sum, row) => sum + row.count, 0), stats.total);
});
test("review counts use latest review outcome, not processing completion or classification", () => {
  const stats = buildDocumentStats([document(), document({ reviewStatus: "pending" }), document({ reviewStatus: "confirmed" })], now);
  assert.equal(stats.pendingReview, 2);
  assert.equal(stats.processed, 3);
});
test("uploads use Denver calendar months, skip missing/future timestamps, and type totals reconcile", () => {
  const stats = buildDocumentStats([
    document({ createdAt: "2026-10-01T02:00:00Z" }), document({ createdAt: "2026-10-01T18:00:00Z", aiDocumentType: "noa" }),
    document({ createdAt: null }), document({ createdAt: "2026-11-01T18:00:00Z" }),
  ], now);
  assert.equal(stats.uploads[4].count, 1);
  assert.equal(stats.uploads[5].count, 1);
  assert.equal(stats.types.reduce((sum, row) => sum + row.count, 0), stats.total);
});

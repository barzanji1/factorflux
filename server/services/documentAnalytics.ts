import { sql } from "drizzle-orm";
import { db } from "../db";
import { buildDocumentStats, documentProcessingState, normalizeDocumentConfidence, type DocumentAnalyticsRow } from "../../shared/document-analytics";

const jobLookup = sql`LEFT JOIN LATERAL (
  SELECT j.id, j.status FROM doc_extraction_jobs j WHERE j.document_id = d.id ORDER BY j.id DESC LIMIT 1
) job ON true`;
const resultLookup = sql`LEFT JOIN LATERAL (
  SELECT r.confidence_score FROM doc_extraction_results r
  WHERE r.document_id = d.id AND (job.id IS NULL OR r.job_id = job.id)
  ORDER BY r.id DESC LIMIT 1
) result ON true`;

export async function readDocumentStats(user: { id: string; role: string }) {
  const scope = user.role === "employee" ? sql`i.submitted_by = ${user.id}` : sql`true`;
  const result = await db.execute(sql`
    SELECT d.status, d.created_at AS "createdAt", d.document_type AS "documentType",
      d.final_document_type AS "finalDocumentType", d.candidate_document_type AS "candidateDocumentType",
      d.ai_document_type AS "aiDocumentType", d.classification_source AS "classificationSource",
      job.status AS "jobStatus", result.confidence_score AS "ocrConfidence", review.review_status AS "reviewStatus"
    FROM documents d LEFT JOIN invoices i ON i.id = d.invoice_id
    ${jobLookup} ${resultLookup}
    LEFT JOIN LATERAL (
      SELECT r.review_status FROM doc_reviews r WHERE r.document_id = d.id ORDER BY r.id DESC LIMIT 1
    ) review ON true
    WHERE ${scope}
  `);
  return buildDocumentStats(result.rows as unknown as DocumentAnalyticsRow[]);
}

export async function documentListMetadata(ids: number[]) {
  if (!ids.length) return new Map();
  const result = await db.execute(sql`
    SELECT d.id, i.invoice_number AS "invoiceNumber", c.id AS "carrierId", c.name AS "carrierName",
      d.status, job.status AS "jobStatus", result.confidence_score AS confidence
    FROM documents d LEFT JOIN invoices i ON i.id = d.invoice_id
    LEFT JOIN clients c ON c.id = coalesce(d.client_id, i.client_id)
    ${jobLookup} ${resultLookup}
    WHERE d.id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})
  `);
  return new Map(result.rows.map(row => {
    const processingState = documentProcessingState(String(row.status), row.jobStatus as string | null);
    return [Number(row.id), {
      invoiceNumber: row.invoiceNumber ?? null, carrierId: row.carrierId ?? null, carrierName: row.carrierName ?? null,
      processingState, ocrConfidence: processingState === "processed" ? normalizeDocumentConfidence(row.confidence) : null,
    }];
  }));
}

export async function readDocumentExtractionSummary(documentId: number) {
  const result = await db.execute(sql`
    WITH job AS (
      SELECT id, status, started_at FROM doc_extraction_jobs WHERE document_id = ${documentId} ORDER BY id DESC LIMIT 1
    ), extraction AS (
      SELECT r.main_text, r.full_text, r.confidence_score FROM doc_extraction_results r
      WHERE r.document_id = ${documentId}
        AND (NOT EXISTS (SELECT 1 FROM job) OR r.job_id = (SELECT id FROM job))
        AND NOT EXISTS (SELECT 1 FROM job WHERE status <> 'completed')
      ORDER BY r.id DESC LIMIT 1
    ), fields AS (
      SELECT DISTINCT ON (f.field_name) f.field_name, coalesce(f.normalized_value, f.field_value) AS value, f.confidence_score
      FROM doc_field_candidates f WHERE f.document_id = ${documentId}
        AND EXISTS (SELECT 1 FROM extraction)
        AND (NOT EXISTS (SELECT 1 FROM job WHERE started_at IS NOT NULL) OR f.created_at >= (SELECT started_at FROM job))
      ORDER BY f.field_name, f.id DESC
    )
    SELECT coalesce((SELECT left(coalesce(nullif(main_text, ''), full_text, ''), 200) FROM extraction), '') AS "textPreview",
      (SELECT confidence_score FROM extraction) AS confidence,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name', field_name, 'value', value, 'confidence', confidence_score)) FROM fields), '[]'::jsonb) AS fields
  `);
  const row = result.rows[0] as { textPreview: string; confidence: string | null; fields: { name: string; value: string | null; confidence: string | null }[] };
  return {
    textPreview: row.textPreview, confidence: normalizeDocumentConfidence(row.confidence),
    fields: row.fields.filter(field => field.value != null).map(field => ({
      ...field, confidence: normalizeDocumentConfidence(field.confidence),
    })),
  };
}

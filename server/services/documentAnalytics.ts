import { sql } from "drizzle-orm";
import { db } from "../db";
import { buildDocumentStats, documentProcessingState, normalizeDocumentConfidence, type DocumentAnalyticsRow } from "../../shared/document-analytics";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { z } from "zod";

const jobLookup = sql`LEFT JOIN LATERAL (
  SELECT j.id, j.status FROM doc_extraction_jobs j WHERE j.document_id = d.id ORDER BY j.id DESC LIMIT 1
) job ON true`;
const resultLookup = sql`LEFT JOIN LATERAL (
  SELECT r.confidence_score FROM doc_extraction_results r
  WHERE r.document_id = d.id AND (job.id IS NULL OR r.job_id = job.id)
  ORDER BY r.id DESC LIMIT 1
) result ON true`;

const documentPageFilters = z.object({
  page: z.coerce.number().int().positive().max(100000).default(1),
  limit: z.coerce.number().int().positive().max(200).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(300).optional(), type: z.string().max(100).optional(),
  source: z.string().max(100).optional(), status: z.string().max(100).optional(),
  confidence: z.enum(["all", "high", "medium", "low"]).optional(),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  focusId: z.coerce.number().int().positive().optional(),
});

export async function readDocumentPageIds(input: unknown, user: { id: string; role: string }) {
  const f = documentPageFilters.parse(input);
  const where = [sql`true`];
  if (user.role === "employee") where.push(sql`submitted_by = ${user.id}`);
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(sql`concat_ws(' ', original_name, invoice_number, carrier_name, invoice_id) ILIKE ${term}`);
  }
  if (f.type && f.type !== "all") {
    const aliases: Record<string, string[]> = { invoice: ["invoice", "freight_invoice"], freight_invoice: ["invoice", "freight_invoice"],
      bol: ["bol", "bill_of_lading"], bill_of_lading: ["bol", "bill_of_lading"], pod: ["pod", "proof_of_delivery"], proof_of_delivery: ["pod", "proof_of_delivery"] };
    const types = [...new Set(f.type.split(",").flatMap(type => aliases[type] ?? [type]))];
    where.push(sql`classification IN (${sql.join(types.map(type => sql`${type}`), sql`,`)})`);
  }
  if (f.source && f.source !== "all") where.push(sql`source = ${f.source}`);
  if (f.status && f.status !== "all") where.push(sql`processing_state = ${f.status}`);
  if (f.confidence === "high") where.push(sql`confidence >= 0.8`);
  if (f.confidence === "medium") where.push(sql`confidence >= 0.6 AND confidence < 0.8`);
  if (f.confidence === "low") where.push(sql`confidence < 0.6`);
  if (f.from) where.push(sql`created_at >= ${f.from}::timestamptz AT TIME ZONE 'UTC'`);
  if (f.to) where.push(sql`created_at <= ${f.to}::timestamptz AT TIME ZONE 'UTC'`);
  const query = await db.execute(sql`
    WITH source AS (
      SELECT d.id, d.original_name, d.invoice_id, d.created_at, i.invoice_number, i.submitted_by, c.name AS carrier_name,
        CASE WHEN d.classification_source = 'agent' THEN coalesce(nullif(d.final_document_type,''), nullif(d.document_type,''), 'other')
          ELSE coalesce(nullif(d.ai_document_type,''), nullif(d.candidate_document_type,''), nullif(d.final_document_type,''), nullif(d.document_type,''), 'other') END AS classification,
        coalesce(d.classification_source,'rules') AS source,
        CASE job.status WHEN 'failed' THEN 'failed' WHEN 'queued' THEN 'pending' WHEN 'processing' THEN 'processing'
          WHEN 'completed' THEN 'processed' ELSE CASE WHEN d.status IN ('processed','failed','processing') THEN d.status ELSE 'pending' END END AS processing_state,
        CASE WHEN job.status = 'completed' OR job.status IS NULL AND d.status = 'processed'
          THEN CASE WHEN result.confidence_score::numeric BETWEEN 0 AND 1 THEN result.confidence_score::numeric
            WHEN result.confidence_score::numeric BETWEEN 1 AND 100 THEN result.confidence_score::numeric / 100 ELSE NULL END
          ELSE NULL END AS confidence
      FROM documents d LEFT JOIN invoices i ON i.id = d.invoice_id
      LEFT JOIN clients c ON c.id = coalesce(d.client_id, i.client_id) ${jobLookup} ${resultLookup}
    ), filtered AS MATERIALIZED (
      SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS position FROM source WHERE ${sql.join(where, sql` AND `)}
    ), selection AS (
      SELECT coalesce(${f.focusId ? sql`(SELECT ceil(position::numeric / ${f.limit})::int FROM filtered WHERE id = ${f.focusId})` : sql`NULL::int`}, ${f.page}) AS page
    ), page AS (
      SELECT id FROM filtered ORDER BY position LIMIT ${f.limit} OFFSET ((SELECT page FROM selection) - 1) * ${f.limit}
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total, (SELECT page FROM selection) AS page,
      coalesce((SELECT jsonb_agg(id) FROM page), '[]'::jsonb) AS ids`);
  return { ...(query.rows[0] as { total: number; page: number; ids: number[] }), limit: f.limit };
}

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

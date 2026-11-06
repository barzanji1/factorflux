import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { documents, docExtractionJobs, docExtractionResults, docFieldCandidates } from "../../shared/schema";
import { findOcrBrokerMatch } from "./ocrBrokerMatching";
import { IntakeError, mapIntakeDocuments, type IntakeDocument } from "./ocrIntakeMapping";
import { normalizeIntakeType } from "./ocr/textractQueries";

export function parseIntakeIds(value: unknown): number[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new IntakeError("ocrDocumentIds must contain up to twenty positive integer IDs");
  }
  if (new Set(value).size !== value.length) throw new IntakeError("Duplicate intake document IDs");
  return value;
}

export async function getIntakeSnapshot(ids: number[], user: { id: string; role: string }, client: Pick<typeof db, "select" | "execute"> = db) {
  const rows = ids.length ? await client.select().from(documents).where(inArray(documents.id, ids)) : [];
  if (rows.length !== ids.length) throw new IntakeError("Intake document not found", 404);
  for (const row of rows) if (row.uploadedBy !== user.id && !["admin", "manager"].includes(user.role)) {
    throw new IntakeError("You may only extract your own intake documents", 403);
  }
  const extracted: IntakeDocument[] = [];
  for (const row of rows) {
    const [job] = await client.select().from(docExtractionJobs).where(eq(docExtractionJobs.documentId, row.id))
      .orderBy(desc(docExtractionJobs.id)).limit(1);
    const fields: Record<string, string> = {}, confidence: Record<string, number> = {};
    const [result] = job?.status === "completed" ? await client.select().from(docExtractionResults)
      .where(and(eq(docExtractionResults.documentId, row.id), eq(docExtractionResults.jobId, job.id))).limit(1) : [];
    if (job?.status === "completed") {
      const candidates = await client.select().from(docFieldCandidates).where(eq(docFieldCandidates.documentId, row.id))
        .orderBy(asc(docFieldCandidates.id));
      const structured = (result?.rawPayloadJson as any)?.fields;
      const keys: Record<string, string> = { invoice_number: "invoiceNumber", load_number: "loadNumber",
        broker_name: "brokerName", amount: "amount", invoice_date: "invoiceDate", service_date: "serviceDate",
        load_number_label: "loadNumberSourceLabel", pickup_date: "pickupDate", delivery_date: "deliveryDate",
        rate: "rate", origin: "origin", destination: "destination", bol_number: "bolNumber", pod_signature: "receiverSignature" };
      for (const candidate of candidates) if (candidate.normalizedValue != null) {
        fields[candidate.fieldName] = candidate.normalizedValue;
        confidence[candidate.fieldName] = Number(candidate.confidenceScore);
      }
      // Latest job structured values are authoritative, including explicit unknowns.
      if (structured) for (const [key, property] of Object.entries(keys)) {
        if (structured[property] == null) { delete fields[key]; delete confidence[key]; }
        else {
          fields[key] = String(structured[property]);
          confidence[key] = structured.fieldConfidences?.[property] ?? Number(result?.confidenceScore ?? 0);
        }
      }
      for (const key of ["broker_id", "broker_match_confidence", "broker_matched_name"]) delete fields[key];
    }
    const raw = (result?.rawPayloadJson as any)?.providerRaw;
    extracted.push({ documentId: row.id, filename: row.originalName, status: job?.status ?? "queued",
      error: job?.errorMessage, docType: normalizeIntakeType(row.classificationSource === "agent"
        ? row.finalDocumentType ?? row.documentType
        : raw?.docType ?? row.aiDocumentType ?? row.candidateDocumentType ?? row.documentType),
      fields, fieldConfidences: confidence, confidence: Number(result?.confidenceScore ?? 0),
      contentHash: row.sourceSha256 ?? raw?.fileSha256 ?? null, invoiceId: row.invoiceId, classification: raw?.classification ?? null });
  }
  const mapped = mapIntakeDocuments(extracted);
  const match = await findOcrBrokerMatch(mapped.fields.broker_name ?? null, client);
  if (match.brokerId && match.confidence) {
    mapped.fields.broker_id = String(match.brokerId);
    mapped.fields.broker_match_confidence = match.confidence;
  }
  const failed = extracted.find(doc => doc.status === "failed");
  const status = failed ? "failed" : extracted.some(doc => ["processing", "queued"].includes(doc.status))
    ? "processing" : "completed";
  return { ...mapped, status, error: failed?.error ?? null, documents: extracted, brokerMatch: match };
}

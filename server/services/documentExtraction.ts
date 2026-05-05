import fs from "fs";
import { db } from "../db";
import {
  docExtractionJobs,
  docExtractionResults,
  docFieldCandidates,
  documents,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

// ─── PDF text extraction (pdf-parse) ─────────────────────────────────────────
async function extractPdfText(
  filePath: string,
): Promise<{ text: string; method: string; confidence: number }> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text ?? "";
    const confidence =
      text.trim().length > 300 ? 0.9
      : text.trim().length > 60  ? 0.65
      : 0.2;
    return { text, method: "native_pdf", confidence };
  } catch (err: any) {
    return { text: "", method: "native_pdf_failed", confidence: 0 };
  }
}

// ─── Field extraction helpers ─────────────────────────────────────────────────
type FieldResult = { value: string; normalized: string; confidence: number } | null;

function extractAmount(text: string): FieldResult {
  const matches = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/g) ?? [];
  const amounts = matches
    .map((m) => parseFloat(m.replace(/[$,\s]/g, "")))
    .filter(Boolean);
  if (!amounts.length) return null;
  const max = Math.max(...amounts);
  return { value: `$${max.toFixed(2)}`, normalized: String(max), confidence: 0.78 };
}

function extractLoadNumber(text: string): FieldResult {
  const m = text.match(
    /(?:load\s*(?:no|number|num|#)?|order\s*(?:no|#)?)[:\s#]*([A-Z0-9]{4,15})/i,
  );
  if (m) return { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.82 };
  return null;
}

function extractInvoiceNumber(text: string): FieldResult {
  const m = text.match(
    /(?:invoice|inv|ref|confirmation|conf)[:\s#]*([A-Z0-9-]{4,20})/i,
  );
  if (m) return { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.8 };
  return null;
}

function extractMcNumber(text: string): FieldResult {
  const m = text.match(/MC[:\s#-]*([\d]{4,8})/i);
  if (m) return { value: `MC${m[1]}`, normalized: m[1], confidence: 0.92 };
  return null;
}

function extractDotNumber(text: string): FieldResult {
  const m = text.match(/(?:USDOT|DOT)[:\s#-]*([\d]{4,9})/i);
  if (m) return { value: m[1], normalized: m[1], confidence: 0.92 };
  return null;
}

function extractPickupLocation(text: string): FieldResult {
  const m = text.match(
    /(?:origin|pickup|ship(?:per)?|p\/u|pu)[:\s]+([A-Za-z\s]+,\s*[A-Z]{2})/i,
  );
  if (m)
    return {
      value: m[1].trim(),
      normalized: m[1].trim().toUpperCase(),
      confidence: 0.72,
    };
  return null;
}

function extractDeliveryLocation(text: string): FieldResult {
  const m = text.match(
    /(?:destination|delivery|consignee|del(?:ivery)?)[:\s]+([A-Za-z\s]+,\s*[A-Z]{2})/i,
  );
  if (m)
    return {
      value: m[1].trim(),
      normalized: m[1].trim().toUpperCase(),
      confidence: 0.72,
    };
  return null;
}

function extractDate(text: string): FieldResult {
  const m = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  if (m) return { value: m[1], normalized: m[1], confidence: 0.65 };
  return null;
}

function classifyDocumentType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("rate confirmation") || lower.includes("rate con"))
    return "rate_confirmation";
  if (lower.includes("bill of lading") || lower.includes("bol"))
    return "bill_of_lading";
  if (lower.includes("proof of delivery") || lower.includes("pod"))
    return "proof_of_delivery";
  if (lower.includes("lumper") || lower.includes("unloading receipt"))
    return "lumper_receipt";
  if (lower.includes("driver") && lower.includes("license"))
    return "driver_id";
  return null;
}

// ─── Snippet helper ───────────────────────────────────────────────────────────
function snippet(text: string, value: string): string {
  const idx = text.indexOf(value);
  if (idx < 0) return "";
  return text
    .slice(Math.max(0, idx - 30), idx + value.length + 30)
    .replace(/\n/g, " ")
    .trim();
}

// ─── Main extraction pipeline ─────────────────────────────────────────────────
export async function runExtractionJob(
  documentId: number,
  jobId: number,
  filePath: string,
  mimeType: string,
): Promise<void> {
  try {
    await db
      .update(docExtractionJobs)
      .set({ status: "processing", startedAt: new Date(), parserName: "pdf-parse+heuristic" })
      .where(eq(docExtractionJobs.id, jobId));

    let extracted = { text: "", method: "unknown", confidence: 0 };

    const isPdf =
      mimeType === "application/pdf" ||
      filePath.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      extracted = await extractPdfText(filePath);
    } else {
      extracted = {
        text: "",
        method: "image_ocr_pending",
        confidence: 0,
      };
    }

    await db.insert(docExtractionResults).values({
      documentId,
      jobId,
      fullText: extracted.text,
      rawPayloadJson: {
        method: extracted.method,
        charCount: extracted.text.length,
      },
      confidenceScore: String(extracted.confidence),
      extractionMethod: extracted.method,
    });

    const candidates: Array<{
      documentId: number;
      fieldName: string;
      fieldValue: string;
      normalizedValue: string;
      confidenceScore: string;
      sourceSnippet: string;
    }> = [];

    function add(name: string, res: FieldResult) {
      if (res) {
        candidates.push({
          documentId,
          fieldName: name,
          fieldValue: res.value,
          normalizedValue: res.normalized,
          confidenceScore: String(res.confidence),
          sourceSnippet: snippet(extracted.text, res.value),
        });
      }
    }

    add("amount",            extractAmount(extracted.text));
    add("load_number",       extractLoadNumber(extracted.text));
    add("invoice_number",    extractInvoiceNumber(extracted.text));
    add("mc_number",         extractMcNumber(extracted.text));
    add("dot_number",        extractDotNumber(extracted.text));
    add("pickup_location",   extractPickupLocation(extracted.text));
    add("delivery_location", extractDeliveryLocation(extracted.text));
    add("date",              extractDate(extracted.text));

    const detectedType = classifyDocumentType(extracted.text);
    if (detectedType) {
      candidates.push({
        documentId,
        fieldName:      "document_type",
        fieldValue:     detectedType.replace(/_/g, " "),
        normalizedValue: detectedType,
        confidenceScore: "0.75",
        sourceSnippet:  "",
      });
    }

    if (candidates.length > 0) {
      await db.insert(docFieldCandidates).values(candidates);
    }

    await db
      .update(docExtractionJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(docExtractionJobs.id, jobId));

    await db
      .update(documents)
      .set({ status: "processed" })
      .where(eq(documents.id, documentId));
  } catch (err: any) {
    await db
      .update(docExtractionJobs)
      .set({
        status: "failed",
        errorMessage: String(err?.message ?? err),
        completedAt: new Date(),
      })
      .where(eq(docExtractionJobs.id, jobId));
  }
}

/**
 * documentExtraction.ts
 * ─────────────────────
 * Hybrid extraction pipeline:
 *   PDF  → native text (pdf-parse) → OCR fallback if text is too short
 *   Image → OCR directly via Tesseract.js
 *
 * Per-page text is preserved in the `pageTexts` JSONB column.
 * `fullText` = raw combined output; `mainText` = cleaned/normalised.
 * Confidence scores are recorded per result and per field candidate.
 */

import fs from "fs";
import { db } from "../db";
import {
  docExtractionJobs,
  docExtractionResults,
  docFieldCandidates,
  documents,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PageResult {
  page:       number;
  text:       string;
  method:     string;
  confidence: number;
}

interface ExtractionOutput {
  fullText:   string;
  mainText:   string;
  method:     string;
  confidence: number;
  pageTexts:  PageResult[];
  pageCount:  number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
/** Below this char count we assume the PDF is image-based and fall back to OCR */
const NATIVE_TEXT_THRESHOLD = 150;

// ─── OCR via Tesseract.js ─────────────────────────────────────────────────────
async function runOcr(
  filePath: string,
): Promise<{ text: string; confidence: number }> {
  try {
    // Dynamic import so startup is not blocked if Tesseract is slow to initialise
    const { recognize } = await import("tesseract.js");
    const result = await recognize(filePath, "eng", { logger: () => {} });
    const text       = result.data.text ?? "";
    const confidence = (result.data.confidence ?? 0) / 100;
    return { text, confidence };
  } catch (err: any) {
    console.warn("[OCR] Tesseract.recognize failed:", err?.message);
    return { text: "", confidence: 0 };
  }
}

// ─── Native PDF extraction (pdf-parse) ───────────────────────────────────────
async function extractPdfNative(filePath: string): Promise<{
  text:      string;
  pageCount: number;
  pages:     PageResult[];
}> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer   = fs.readFileSync(filePath);

    // Collect per-page text via the pdf-parse pagerender hook
    const rawPages: string[] = [];
    const data = await pdfParse(buffer, {
      pagerender(pageData: any) {
        return pageData.getTextContent().then((tc: any) => {
          const pageText: string = tc.items
            .map((i: any) => (typeof i.str === "string" ? i.str : ""))
            .join(" ")
            .trim();
          rawPages.push(pageText);
          return pageText;
        });
      },
    });

    const fullText  = data.text ?? "";
    const pageCount = data.numpages ?? Math.max(rawPages.length, 1);

    // Build per-page results — fall back to splitting fullText if hook didn't fire
    const pageSources: string[] =
      rawPages.length > 0 ? rawPages : splitByFormFeed(fullText, pageCount);

    const pages: PageResult[] = pageSources.map((t, i) => ({
      page:       i + 1,
      text:       t,
      method:     "native_pdf",
      confidence: t.trim().length > 50 ? 0.9 : 0.4,
    }));

    return { text: fullText, pageCount, pages };
  } catch (err: any) {
    console.warn("[PDF] pdf-parse failed:", err?.message);
    return { text: "", pageCount: 0, pages: [] };
  }
}

/** Split text into approximate pages using form-feed chars or even distribution. */
function splitByFormFeed(text: string, pageCount: number): string[] {
  const ff = text.split("\x0c");
  if (ff.length === pageCount) return ff;
  // Even split
  const chunkSize = Math.ceil(text.length / Math.max(pageCount, 1));
  const chunks: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    chunks.push(text.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  return chunks;
}

// ─── Hybrid pipeline entry point ─────────────────────────────────────────────
async function hybridExtract(
  filePath: string,
  mimeType: string,
): Promise<ExtractionOutput> {
  const isPdf =
    mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    // Step 1: try native text extraction
    const native = await extractPdfNative(filePath);
    const cleanNative = native.text.replace(/\s+/g, " ").trim();

    if (cleanNative.length >= NATIVE_TEXT_THRESHOLD) {
      return {
        fullText:   native.text,
        mainText:   cleanNative,
        method:     "native_pdf",
        confidence: 0.9,
        pageTexts:  native.pages,
        pageCount:  native.pageCount,
      };
    }

    // Step 2: native text too short — run OCR fallback
    console.log(
      `[Extraction] PDF native text only ${cleanNative.length} chars — running OCR fallback`,
    );
    const ocr = await runOcr(filePath);

    const bestText = ocr.text.trim().length > cleanNative.length
      ? ocr.text
      : native.text;

    const ocrPages: PageResult[] = ocr.text.trim().length > 0
      ? [{ page: 1, text: ocr.text, method: "ocr", confidence: ocr.confidence }]
      : [];

    const pages = [
      ...native.pages.filter(p => p.text.trim().length > 10),
      ...ocrPages,
    ];

    return {
      fullText:   bestText,
      mainText:   bestText.replace(/\s{3,}/g, "\n\n").trim(),
      method:     ocrPages.length > 0 ? "hybrid_ocr" : "native_pdf_low_confidence",
      confidence: ocrPages.length > 0 ? ocr.confidence : 0.25,
      pageTexts:  pages.length > 0
        ? pages
        : [{ page: 1, text: bestText, method: "hybrid_ocr", confidence: ocr.confidence }],
      pageCount: Math.max(native.pageCount, 1),
    };
  }

  // Image file — OCR directly
  const ocr = await runOcr(filePath);
  return {
    fullText:  ocr.text,
    mainText:  ocr.text.replace(/\s{3,}/g, "\n\n").trim(),
    method:    "image_ocr",
    confidence: ocr.confidence,
    pageTexts: [{ page: 1, text: ocr.text, method: "image_ocr", confidence: ocr.confidence }],
    pageCount: 1,
  };
}

// ─── Field extraction helpers ─────────────────────────────────────────────────
type FieldResult = { value: string; normalized: string; confidence: number } | null;

function extractAmount(text: string): FieldResult {
  const matches = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/g) ?? [];
  const amounts = matches
    .map(m => parseFloat(m.replace(/[$,\s]/g, "")))
    .filter(Boolean);
  if (!amounts.length) return null;
  const max = Math.max(...amounts);
  return { value: `$${max.toFixed(2)}`, normalized: String(max), confidence: 0.78 };
}

function extractLoadNumber(text: string): FieldResult {
  const m = text.match(
    /(?:load\s*(?:no|number|num|#)?|order\s*(?:no|#)?)[:\s#]*([A-Z0-9]{4,15})/i,
  );
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.82 } : null;
}

function extractInvoiceNumber(text: string): FieldResult {
  const m = text.match(
    /(?:invoice|inv|ref|confirmation|conf)[:\s#]*([A-Z0-9-]{4,20})/i,
  );
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.8 } : null;
}

function extractMcNumber(text: string): FieldResult {
  const m = text.match(/MC[:\s#-]*([\d]{4,8})/i);
  return m ? { value: `MC${m[1]}`, normalized: m[1], confidence: 0.92 } : null;
}

function extractDotNumber(text: string): FieldResult {
  const m = text.match(/(?:USDOT|DOT)[:\s#-]*([\d]{4,9})/i);
  return m ? { value: m[1], normalized: m[1], confidence: 0.92 } : null;
}

function extractPickupLocation(text: string): FieldResult {
  const m = text.match(
    /(?:origin|pickup|ship(?:per)?|p\/u|pu)[:\s]+([A-Za-z\s]+,\s*[A-Z]{2})/i,
  );
  return m
    ? { value: m[1].trim(), normalized: m[1].trim().toUpperCase(), confidence: 0.72 }
    : null;
}

function extractDeliveryLocation(text: string): FieldResult {
  const m = text.match(
    /(?:destination|delivery|consignee|del(?:ivery)?)[:\s]+([A-Za-z\s]+,\s*[A-Z]{2})/i,
  );
  return m
    ? { value: m[1].trim(), normalized: m[1].trim().toUpperCase(), confidence: 0.72 }
    : null;
}

function extractDate(text: string): FieldResult {
  const m = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  return m ? { value: m[1], normalized: m[1], confidence: 0.65 } : null;
}

function extractBolNumber(text: string): FieldResult {
  const m = text.match(/(?:b\/l|bol|bill\s+of\s+lading)[:\s#]*([A-Z0-9-]{4,20})/i);
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.85 } : null;
}

function extractCarrierName(text: string): FieldResult {
  const m = text.match(/(?:carrier|trucking|transport)[:\s]+([A-Z][A-Za-z\s&,\.]{3,40}?)(?:\n|,|MC|DOT)/i);
  return m ? { value: m[1].trim(), normalized: m[1].trim(), confidence: 0.6 } : null;
}

function classifyDocumentType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("rate confirmation") || lower.includes("rate con")) return "rate_confirmation";
  if (lower.includes("bill of lading") || lower.includes("bol"))         return "bill_of_lading";
  if (lower.includes("proof of delivery") || lower.includes("pod"))      return "proof_of_delivery";
  if (lower.includes("lumper") || lower.includes("unloading receipt"))   return "lumper_receipt";
  if (lower.includes("driver") && lower.includes("license"))             return "driver_id";
  return null;
}

function sourceSnippet(text: string, value: string): string {
  const idx = text.indexOf(value);
  if (idx < 0) return "";
  return text
    .slice(Math.max(0, idx - 30), idx + value.length + 30)
    .replace(/\n/g, " ")
    .trim();
}

// ─── Main job handler (called by jobQueue) ────────────────────────────────────
export async function runExtractionJob(
  documentId: number,
  jobId:       number,
  filePath:    string,
  mimeType:    string,
): Promise<void> {
  try {
    await db
      .update(docExtractionJobs)
      .set({
        status:     "processing",
        startedAt:  new Date(),
        parserName: "pdf-parse+tesseract-hybrid",
      })
      .where(eq(docExtractionJobs.id, jobId));

    const extracted = await hybridExtract(filePath, mimeType);

    await db.insert(docExtractionResults).values({
      documentId,
      jobId,
      fullText:          extracted.fullText,
      mainText:          extracted.mainText,
      pageTexts:         extracted.pageTexts,
      rawPayloadJson: {
        method:    extracted.method,
        charCount: extracted.fullText.length,
        pageCount: extracted.pageCount,
        pagesExtracted: extracted.pageTexts.length,
      },
      confidenceScore:   String(extracted.confidence),
      extractionMethod:  extracted.method,
      pageCount:         extracted.pageCount,
    });

    // ── Field candidates ──────────────────────────────────────────────────────
    const t = extracted.mainText || extracted.fullText;
    const candidates: Array<{
      documentId:     number;
      fieldName:      string;
      fieldValue:     string;
      normalizedValue: string;
      confidenceScore: string;
      sourceSnippet:  string;
    }> = [];

    const add = (name: string, res: FieldResult) => {
      if (res) {
        candidates.push({
          documentId,
          fieldName:       name,
          fieldValue:      res.value,
          normalizedValue: res.normalized,
          confidenceScore: String(res.confidence),
          sourceSnippet:   sourceSnippet(t, res.value),
        });
      }
    };

    add("amount",            extractAmount(t));
    add("load_number",       extractLoadNumber(t));
    add("invoice_number",    extractInvoiceNumber(t));
    add("mc_number",         extractMcNumber(t));
    add("dot_number",        extractDotNumber(t));
    add("pickup_location",   extractPickupLocation(t));
    add("delivery_location", extractDeliveryLocation(t));
    add("date",              extractDate(t));
    add("bol_number",        extractBolNumber(t));
    add("carrier_name",      extractCarrierName(t));

    const detectedType = classifyDocumentType(t);
    if (detectedType) {
      candidates.push({
        documentId,
        fieldName:       "document_type",
        fieldValue:      detectedType.replace(/_/g, " "),
        normalizedValue: detectedType,
        confidenceScore: "0.75",
        sourceSnippet:   "",
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
    console.error(`[Extraction] job ${jobId} failed:`, err?.message);
    await db
      .update(docExtractionJobs)
      .set({
        status:       "failed",
        errorMessage: String(err?.message ?? err),
        completedAt:  new Date(),
      })
      .where(eq(docExtractionJobs.id, jobId))
      .catch(() => {});
  }
}

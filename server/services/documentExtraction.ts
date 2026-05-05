/**
 * documentExtraction.ts
 * ─────────────────────
 * Hybrid extraction pipeline:
 *   PDF  → native text (pdf-parse) → OCR fallback if text is too short
 *   Image → OCR directly via Tesseract.js
 *
 * Classification: rule-based multi-signal scoring over 7 document types.
 * Field extraction: 16 named fields saved as doc_field_candidates.
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

export interface ClassificationResult {
  docType:    string;
  confidence: number;
  signals:    string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const NATIVE_TEXT_THRESHOLD = 150;

// ─── Document classification rules ───────────────────────────────────────────
/**
 * Each rule group has a list of signal sets with weights.
 * Score = sum of weights of matched signals; normalised to [0,1].
 * Easy to extend: just add more entries to any group.
 */
const DOC_TYPE_SIGNALS: Record<
  string,
  Array<{ patterns: string[]; weight: number }>
> = {
  rate_confirmation: [
    { patterns: ["rate confirmation", "rate con", "rc #", "rate conf"], weight: 1.0 },
    { patterns: ["agreed rate", "contracted rate", "load rate"],         weight: 0.8 },
    { patterns: ["load tender", "rate agreement", "contract rate"],      weight: 0.7 },
    { patterns: ["dispatch confirmation", "load dispatch"],              weight: 0.6 },
    { patterns: ["broker", "shipper", "carrier agrees"],                 weight: 0.2 },
  ],
  bill_of_lading: [
    { patterns: ["bill of lading", "bol number", "b.o.l"],              weight: 1.0 },
    { patterns: ["b/l number", "bol #", "bol#"],                        weight: 0.9 },
    { patterns: ["consignee", "pro number"],                             weight: 0.5 },
    { patterns: ["freight charges prepaid", "commodity", "packages"],   weight: 0.4 },
    { patterns: ["shipper", "origin", "destination"],                   weight: 0.2 },
  ],
  proof_of_delivery: [
    { patterns: ["proof of delivery", "pod #", "delivery receipt"],     weight: 1.0 },
    { patterns: ["delivery confirmed", "delivered to"],                  weight: 0.85 },
    { patterns: ["received by", "received in good condition"],           weight: 0.8 },
    { patterns: ["recipient signature", "driver signature", "signed"],   weight: 0.6 },
    { patterns: ["delivery date", "time of delivery"],                   weight: 0.3 },
  ],
  lumper_receipt: [
    { patterns: ["lumper receipt", "lumper fee", "lumper service"],     weight: 1.0 },
    { patterns: ["lumper", "unloading fee", "unloading receipt"],        weight: 0.9 },
    { patterns: ["warehouse labor", "unloading labor", "loading fee"],   weight: 0.7 },
    { patterns: ["detention", "layover", "unload"],                      weight: 0.3 },
  ],
  invoice: [
    { patterns: ["invoice number", "invoice #", "inv #", "inv#"],       weight: 1.0 },
    { patterns: ["bill to", "invoice date", "invoice total"],            weight: 0.85 },
    { patterns: ["amount due", "payment due", "remit to"],               weight: 0.8 },
    { patterns: ["net 30", "net 60", "due upon receipt"],                weight: 0.5 },
    { patterns: ["invoice", "billing statement"],                        weight: 0.3 },
  ],
  receipt: [
    { patterns: ["payment receipt", "receipt number", "receipt #"],     weight: 1.0 },
    { patterns: ["payment received", "received payment"],                weight: 0.9 },
    { patterns: ["transaction id", "transaction number"],                weight: 0.8 },
    { patterns: ["total paid", "amount paid", "cash receipt"],          weight: 0.6 },
  ],
};

/** Max possible score per type (sum of all weights). */
const DOC_TYPE_MAX_SCORES: Record<string, number> = Object.fromEntries(
  Object.entries(DOC_TYPE_SIGNALS).map(([type, rules]) => [
    type,
    rules.reduce((s, r) => s + r.weight, 0),
  ]),
);

export function classifyDocument(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  let bestType   = "other";
  let bestScore  = 0;
  let bestSignals: string[] = [];

  for (const [type, rules] of Object.entries(DOC_TYPE_SIGNALS)) {
    let score   = 0;
    const hits: string[] = [];

    for (const rule of rules) {
      const matched = rule.patterns.find((p) => lower.includes(p));
      if (matched) {
        score += rule.weight;
        hits.push(matched);
      }
    }

    const normalised = score / (DOC_TYPE_MAX_SCORES[type] ?? 1);
    if (normalised > bestScore) {
      bestScore   = normalised;
      bestType    = type;
      bestSignals = hits;
    }
  }

  // Require a minimum confidence to assign a type; otherwise "other"
  const MIN_CONFIDENCE = 0.15;
  if (bestScore < MIN_CONFIDENCE) {
    return { docType: "other", confidence: 0, signals: [] };
  }

  // Cap confidence at 0.97 to be honest about rule-based limits
  return {
    docType:    bestType,
    confidence: Math.min(bestScore, 0.97),
    signals:    bestSignals,
  };
}

// ─── OCR via Tesseract.js ─────────────────────────────────────────────────────
async function runOcr(
  filePath: string,
): Promise<{ text: string; confidence: number }> {
  try {
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

function splitByFormFeed(text: string, pageCount: number): string[] {
  const ff = text.split("\x0c");
  if (ff.length === pageCount) return ff;
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
    const native      = await extractPdfNative(filePath);
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

  const ocr = await runOcr(filePath);
  return {
    fullText:   ocr.text,
    mainText:   ocr.text.replace(/\s{3,}/g, "\n\n").trim(),
    method:     "image_ocr",
    confidence: ocr.confidence,
    pageTexts:  [{ page: 1, text: ocr.text, method: "image_ocr", confidence: ocr.confidence }],
    pageCount:  1,
  };
}

// ─── Field extraction helpers ─────────────────────────────────────────────────
type FieldResult = { value: string; normalized: string; confidence: number } | null;

function sourceSnippet(text: string, value: string): string {
  const idx = text.indexOf(value);
  if (idx < 0) return "";
  return text
    .slice(Math.max(0, idx - 30), idx + value.length + 30)
    .replace(/\n/g, " ")
    .trim();
}

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
    /(?:invoice|inv)[:\s#]*([A-Z0-9-]{4,20})/i,
  );
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.8 } : null;
}

function extractReferenceNumber(text: string): FieldResult {
  const m = text.match(
    /(?:reference|ref|confirmation|conf|po\s*(?:number|#)?)[:\s#]*([A-Z0-9-]{4,20})/i,
  );
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.72 } : null;
}

function extractBrokerName(text: string): FieldResult {
  const m = text.match(
    /(?:broker|brokerage|freight\s+broker)[:\s]+([A-Z][A-Za-z\s&,\.]{3,50}?)(?:\n|,|LLC|Inc|Corp|Co\.|$)/i,
  );
  return m ? { value: m[1].trim(), normalized: m[1].trim(), confidence: 0.65 } : null;
}

function extractCarrierName(text: string): FieldResult {
  const m = text.match(
    /(?:carrier|trucking|transport)[:\s]+([A-Z][A-Za-z\s&,\.]{3,40}?)(?:\n|,|MC|DOT)/i,
  );
  return m ? { value: m[1].trim(), normalized: m[1].trim(), confidence: 0.6 } : null;
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

/** Parse dates in MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD formats. */
function parseDate(raw: string): string {
  const parts = raw.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    // YYYY-MM-DD
    if (a.length === 4) return `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`;
    // MM/DD/YYYY
    if (c.length === 4) return `${c}-${a.padStart(2,"0")}-${b.padStart(2,"0")}`;
  }
  return raw;
}

function extractPickupDate(text: string): FieldResult {
  const m = text.match(
    /(?:pickup\s*date|ship\s*date|p\/u\s*date|pickup)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  );
  if (m) return { value: m[1], normalized: parseDate(m[1]), confidence: 0.78 };
  return null;
}

function extractDeliveryDate(text: string): FieldResult {
  const m = text.match(
    /(?:delivery\s*date|del(?:ivery)?\s*date|deliver\s*by)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  );
  if (m) return { value: m[1], normalized: parseDate(m[1]), confidence: 0.78 };
  return null;
}

function extractDate(text: string): FieldResult {
  const m = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  return m ? { value: m[1], normalized: parseDate(m[1]), confidence: 0.55 } : null;
}

function extractBolNumber(text: string): FieldResult {
  const m = text.match(/(?:b\/l|bol|bill\s+of\s+lading)[:\s#]*([A-Z0-9-]{4,20})/i);
  return m ? { value: m[1], normalized: m[1].toUpperCase(), confidence: 0.85 } : null;
}

function extractLumperAmount(text: string): FieldResult {
  const m = text.match(
    /(?:lumper|unloading\s*fee|unload\s*fee)[:\s]*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  );
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ""));
  return { value: `$${val.toFixed(2)}`, normalized: String(val), confidence: 0.82 };
}

function extractPodSignature(text: string): FieldResult {
  const lower = text.toLowerCase();
  const hasSignatureKeyword =
    lower.includes("signature") ||
    lower.includes("signed by") ||
    lower.includes("received by") ||
    lower.includes("recipient signature");
  if (!hasSignatureKeyword) return null;
  return { value: "Yes", normalized: "true", confidence: 0.7 };
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
    const t = extracted.mainText || extracted.fullText;

    // ── Classification ────────────────────────────────────────────────────────
    const classification = classifyDocument(t);

    // ── Save extraction result ────────────────────────────────────────────────
    await db.insert(docExtractionResults).values({
      documentId,
      jobId,
      fullText:         extracted.fullText,
      mainText:         extracted.mainText,
      pageTexts:        extracted.pageTexts,
      rawPayloadJson: {
        method:         extracted.method,
        charCount:      extracted.fullText.length,
        pageCount:      extracted.pageCount,
        pagesExtracted: extracted.pageTexts.length,
        classification: {
          docType:    classification.docType,
          confidence: classification.confidence,
          signals:    classification.signals,
        },
      },
      confidenceScore:  String(extracted.confidence),
      extractionMethod: extracted.method,
      pageCount:        extracted.pageCount,
    });

    // ── Update document with candidate classification ─────────────────────────
    await db
      .update(documents)
      .set({
        candidateDocumentType:   classification.docType as any,
        classificationConfidence: String(classification.confidence),
        status: "processed",
      })
      .where(eq(documents.id, documentId));

    // ── Field candidates ──────────────────────────────────────────────────────
    const candidates: Array<{
      documentId:      number;
      fieldName:       string;
      fieldValue:      string;
      normalizedValue: string;
      confidenceScore: string;
      sourceSnippet:   string;
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
    add("reference_number",  extractReferenceNumber(t));
    add("broker_name",       extractBrokerName(t));
    add("carrier_name",      extractCarrierName(t));
    add("mc_number",         extractMcNumber(t));
    add("dot_number",        extractDotNumber(t));
    add("pickup_location",   extractPickupLocation(t));
    add("delivery_location", extractDeliveryLocation(t));
    add("pickup_date",       extractPickupDate(t));
    add("delivery_date",     extractDeliveryDate(t));
    add("date",              extractDate(t));
    add("bol_number",        extractBolNumber(t));
    add("lumper_amount",     extractLumperAmount(t));
    add("pod_signature",     extractPodSignature(t));

    // Save classification as a field candidate too (for UI display)
    candidates.push({
      documentId,
      fieldName:       "document_type",
      fieldValue:      classification.docType.replace(/_/g, " "),
      normalizedValue: classification.docType,
      confidenceScore: String(classification.confidence),
      sourceSnippet:   classification.signals.join(", "),
    });

    if (candidates.length > 0) {
      await db.insert(docFieldCandidates).values(candidates);
    }

    await db
      .update(docExtractionJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(docExtractionJobs.id, jobId));

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
    await db
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, documentId))
      .catch(() => {});
  }
}

/**
 * documentExtraction.ts
 * ─────────────────────
 * Hybrid extraction pipeline backed by the OCR provider abstraction.
 * Provider is selected via OCR_PROVIDER (default: textract).
 * See server/services/ocr/registry.ts for available providers.
 *
 * Classification: rule-based multi-signal scoring over 7 document types.
 * Field extraction: 16 named fields saved as doc_field_candidates.
 */

import { db } from "../db";
import {
  docExtractionJobs,
  docExtractionResults,
  docFieldCandidates,
  documents,
} from "../../shared/schema";
import { eq } from "drizzle-orm";
import { getExtractionProvider } from "./ocr/registry";
import { assertSuccessfulExtraction, type ExtractionProvider } from "./ocr/types";
import { classifyDocumentAI, reviewDocumentType } from "./aiClassifier";
import { findOcrBrokerMatch } from "./ocrBrokerMatching";
import { extractInvoiceNumber, extractLoadNumber, extractReferenceNumber, extractBolNumber, type FieldResult } from "./documentFieldDetectors";

// Re-export PageResult so existing callers (e.g. document-review-dialog) keep working
export type { PageResult } from "./ocr/types";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ClassificationResult {
  docType:    string;
  confidence: number;
  signals:    string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

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
    { patterns: ["unloading fee", "unload service", "lumper"],          weight: 0.9 },
    { patterns: ["warehouse", "dock", "receiving"],                     weight: 0.3 },
  ],
  freight_invoice: [
    { patterns: ["freight invoice", "carrier invoice", "invoice #"],    weight: 1.0 },
    { patterns: ["invoice date", "invoice number", "inv #"],            weight: 0.9 },
    { patterns: ["amount due", "payment due", "remit to"],              weight: 0.7 },
    { patterns: ["freight charges", "fuel surcharge", "accessorial"],   weight: 0.6 },
    { patterns: ["total amount", "subtotal", "net amount"],             weight: 0.4 },
  ],
  receipt: [
    { patterns: ["receipt", "payment receipt", "cash receipt"],         weight: 1.0 },
    { patterns: ["received payment", "amount received"],                weight: 0.8 },
    { patterns: ["paid", "payment date", "transaction"],                weight: 0.5 },
  ],
  other: [
    { patterns: ["miscellaneous", "general document"],                  weight: 0.3 },
  ],
};

/**
 * Classify document text by scoring signals for each doc type.
 * Returns the best match or "other" if nothing scores.
 */
export function classifyDocument(text: string): ClassificationResult {
  const lower = text.toLowerCase();

  let bestType    = "other";
  let bestScore   = 0;
  let bestSignals: string[] = [];

  for (const [docType, signalGroups] of Object.entries(DOC_TYPE_SIGNALS)) {
    let score   = 0;
    let maxPoss = 0;
    const matched: string[] = [];

    for (const group of signalGroups) {
      maxPoss += group.weight;
      if (group.patterns.some(p => lower.includes(p))) {
        score += group.weight;
        matched.push(group.patterns[0]);
      }
    }

    const normalised = maxPoss > 0 ? score / maxPoss : 0;
    if (normalised > bestScore) {
      bestScore   = normalised;
      bestType    = docType;
      bestSignals = matched;
    }
  }

  // Cap confidence at 0.97 to be honest about rule-based limits
  return {
    docType:    bestType,
    confidence: Math.min(bestScore, 0.97),
    signals:    bestSignals,
  };
}

// ─── Field extraction helpers ─────────────────────────────────────────────────
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

/** Parse dates in MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD formats. */
function parseDate(raw: string): string {
  const parts = raw.split(/[\/\-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a.length === 4) return `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`;
    if (c.length === 4) return `${c}-${a.padStart(2,"0")}-${b.padStart(2,"0")}`;
  }
  return raw;
}

// ─── Main job handler (called by jobQueue) ────────────────────────────────────
export async function runExtractionJob(
  documentId: number,
  jobId:       number,
  filePath:    string,
  mimeType:    string,
  dependencies: { database?: typeof db; provider?: ExtractionProvider } = {},
): Promise<void> {
  const jobDb = dependencies.database ?? db;

  try {
    const provider = dependencies.provider ?? getExtractionProvider();
    await jobDb
      .update(docExtractionJobs)
      .set({
        status:     "processing",
        startedAt:  new Date(),
        parserName: provider.key,
      })
      .where(eq(docExtractionJobs.id, jobId));

    // ── Extraction via provider ────────────────────────────────────────────────
    const [document] = dependencies.provider ? [] : await jobDb.select({
      documentType: documents.documentType,
    }).from(documents).where(eq(documents.id, documentId)).limit(1);
    const extracted = await provider.extractText(filePath, mimeType, document?.documentType ?? "other");
    assertSuccessfulExtraction(extracted);
    const t = extracted.mainText || extracted.fullText;

    // ── Classification ────────────────────────────────────────────────────────
    const classification = classifyDocument(t);

    // ── Save extraction result ────────────────────────────────────────────────
    await jobDb.insert(docExtractionResults).values({
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
        providerKey:    extracted.providerKey,
        fields:         extracted.fields ?? null,
        providerRaw:    extracted.raw ?? null,
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

    // AI errors must fail the enclosing extraction job, never select rules.
    const routed = extracted.raw as { classification?: Awaited<ReturnType<typeof classifyDocumentAI>>; docType?: string } | undefined;
    const firstPage = (extracted.raw as { pageResults?: { text?: string }[] } | undefined)?.pageResults?.[0]?.text ?? t;
    const aiResult = routed?.classification ?? await classifyDocumentAI(firstPage, classification);
    const finalDocType = reviewDocumentType(aiResult.docType);
    const finalConfidence = aiResult.confidence;

    // ── Update document with candidate classification ─────────────────────────
    await jobDb
      .update(documents)
      .set({
        candidateDocumentType:      finalDocType as any,
        classificationConfidence:   String(finalConfidence),
        aiDocumentType:             finalDocType,
        aiClassificationConfidence: String(aiResult.confidence),
        aiClassificationSignals:    aiResult.signals,
        allClassificationScores:    aiResult.allScores,
        classificationSource:       aiResult.source as any,
        aiClassifiedAt:             new Date(),
        aiClassificationModel:      aiResult.model,
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
      const structured: Record<string, string | number | boolean | null | undefined> = {
        invoice_number: extracted.fields?.invoiceNumber,
        load_number: extracted.fields?.loadNumber,
        amount: extracted.fields?.amount,
        broker_name: extracted.fields?.brokerName,
        service_date: extracted.fields?.serviceDate,
        invoice_date: extracted.fields?.invoiceDate,
        load_number_label: extracted.fields?.loadNumberSourceLabel,
        bol_number: extracted.fields?.bolNumber,
        rate: extracted.fields?.rate, pickup_date: extracted.fields?.pickupDate,
        delivery_date: extracted.fields?.deliveryDate, origin: extracted.fields?.origin,
        destination: extracted.fields?.destination, pod_signature: extracted.fields?.receiverSignature,
      };
      const value = structured[name];
      // Structured providers explicitly return null for unknown fields. Do not
      // replace those unknowns with legacy max-amount/company-name guesses.
      if (extracted.fields && name in structured && value == null) return;
      if (value != null) {
        const key = ({ invoice_number: "invoiceNumber", load_number: "loadNumber", broker_name: "brokerName",
          invoice_date: "invoiceDate", service_date: "serviceDate", pickup_date: "pickupDate",
          delivery_date: "deliveryDate", bol_number: "bolNumber", pod_signature: "receiverSignature" } as Record<string, string>)[name] ?? name;
        res = { value: String(value), normalized: String(value),
          confidence: extracted.fields?.fieldConfidences?.[key] ?? extracted.confidence };
      }
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
    add("service_date",      null);
    add("invoice_date",      null);
    add("load_number_label", null);
    add("rate", null);
    add("origin", null);
    add("destination", null);
    add("lumper_amount",     extractLumperAmount(t));
    add("pod_signature",     extractPodSignature(t));

    const rawBrokerName = candidates.find(candidate => candidate.fieldName === "broker_name")?.fieldValue ?? null;
    if (rawBrokerName) {
      const match = await findOcrBrokerMatch(rawBrokerName, jobDb);
      if (match.brokerId && match.confidence) {
        for (const [name, value] of [["broker_id", String(match.brokerId)],
          ["broker_match_confidence", match.confidence], ["broker_matched_name", match.matchedName!]]) {
          candidates.push({ documentId, fieldName: name, fieldValue: value, normalizedValue: value,
            confidenceScore: match.confidence === "high" ? "1" : "0.85", sourceSnippet: rawBrokerName });
        }
      }
    }

    // Save classification as a field candidate too (for UI display)
    candidates.push({
      documentId,
      fieldName:       "document_type",
      fieldValue:      finalDocType.replace(/_/g, " "),
      normalizedValue: finalDocType,
      confidenceScore: String(finalConfidence),
      sourceSnippet:   aiResult.signals.join(", "),
    });

    if (candidates.length > 0) {
      await jobDb.insert(docFieldCandidates).values(candidates);
    }

    await jobDb
      .update(docExtractionJobs)
      .set({ status: "completed", errorMessage: null, completedAt: new Date() })
      .where(eq(docExtractionJobs.id, jobId));

  } catch (err: any) {
    console.error(`[Extraction] job ${jobId} failed:`, err?.message);
    await jobDb
      .update(docExtractionJobs)
      .set({
        status:       "failed",
        errorMessage: String(err?.message ?? err),
        completedAt:  new Date(),
      })
      .where(eq(docExtractionJobs.id, jobId));
    await jobDb
      .update(documents)
      .set({ status: "failed" })
      .where(eq(documents.id, documentId));
  }
}

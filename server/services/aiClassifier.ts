/**
 * aiClassifier.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * AI-powered document type classification with confidence scores.
 *
 * Strategy:
 *   1. If OPENAI_API_KEY is set → call GPT-4o-mini with a structured prompt.
 *      The model returns docType, confidence, signals, reasoning, and allScores.
 *   2. If no API key → fall back to an enhanced multi-pass rule-based engine
 *      that returns all-type score breakdowns (not just the winner).
 *
 * Both paths return the same AIClassificationResult shape so the caller
 * doesn't need to know which engine ran.
 */

import type { ClassificationResult } from "./documentExtraction";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIClassificationResult {
  docType:    string;
  confidence: number;
  signals:    string[];
  reasoning:  string;
  allScores:  Record<string, number>;
  model:      string;
  source:     "ai" | "rules";
}

// ─── Document types ───────────────────────────────────────────────────────────

export const ALL_DOC_TYPES = [
  "rate_confirmation",
  "bill_of_lading",
  "proof_of_delivery",
  "lumper_receipt",
  "freight_invoice",
  "receipt",
  "other",
] as const;

export type DocType = (typeof ALL_DOC_TYPES)[number];

// ─── Enhanced rule-based engine ───────────────────────────────────────────────
/**
 * Returns a score for every document type (not just the winner).
 * More comprehensive than the basic classifier — includes layout signals,
 * negative signals, and contextual patterns.
 */

interface SignalGroup {
  patterns:  string[];
  weight:    number;
  negative?: string[];  // if any of these appear, halve the score for this group
}

const ENHANCED_SIGNALS: Record<string, SignalGroup[]> = {
  rate_confirmation: [
    { patterns: ["rate confirmation", "rate con", "rc #", "rate conf"],    weight: 1.00 },
    { patterns: ["agreed rate", "contracted rate", "load rate"],           weight: 0.85 },
    { patterns: ["load tender", "rate agreement", "contract rate"],        weight: 0.80 },
    { patterns: ["dispatch confirmation", "load dispatch"],                weight: 0.75 },
    { patterns: ["flat rate", "per mile", "all-in rate", "linehaul"],     weight: 0.70 },
    { patterns: ["accessorial", "fuel surcharge", "detention rate"],       weight: 0.65 },
    { patterns: ["payment terms", "net 30", "factoring company"],          weight: 0.50 },
    { patterns: ["carrier agrees", "driver", "equipment type"],            weight: 0.40 },
    { patterns: ["broker", "shipper", "origin", "destination"],            weight: 0.20 },
  ],
  bill_of_lading: [
    { patterns: ["bill of lading", "bol number", "b.o.l", "b/l number"],  weight: 1.00 },
    { patterns: ["bol #", "bol#", "lading number"],                        weight: 0.95 },
    { patterns: ["consignee", "consignor"],                                weight: 0.75 },
    { patterns: ["pro number", "freight bill"],                            weight: 0.65 },
    { patterns: ["freight charges prepaid", "freight collect"],            weight: 0.60 },
    { patterns: ["commodity", "packages", "pieces", "weight", "class"],   weight: 0.50 },
    { patterns: ["hazmat", "hazardous materials", "nmfc"],                 weight: 0.55 },
    { patterns: ["seal number", "trailer number", "container"],            weight: 0.45 },
    { patterns: ["shipper", "origin", "destination"],                      weight: 0.20 },
  ],
  proof_of_delivery: [
    { patterns: ["proof of delivery", "pod #", "delivery receipt"],       weight: 1.00 },
    { patterns: ["delivery confirmed", "delivered to"],                    weight: 0.90 },
    { patterns: ["received by", "received in good condition"],             weight: 0.85 },
    { patterns: ["recipient signature", "driver signature"],               weight: 0.80 },
    { patterns: ["delivery date", "time of delivery", "arrived at"],      weight: 0.60 },
    { patterns: ["damaged", "shortage", "overage", "exception"],          weight: 0.55 },
    { patterns: ["signed", "signature"],                                   weight: 0.50 },
    { patterns: ["delivered", "delivery"],                                 weight: 0.30 },
  ],
  lumper_receipt: [
    { patterns: ["lumper receipt", "lumper fee", "lumper service"],       weight: 1.00 },
    { patterns: ["unloading fee", "unload service", "unloading receipt"], weight: 0.95 },
    { patterns: ["lumper"],                                                weight: 0.90 },
    { patterns: ["loading fee", "forklift fee", "labor fee"],             weight: 0.70 },
    { patterns: ["warehouse", "dock", "receiving department"],            weight: 0.35 },
    { patterns: ["hours worked", "labor hours"],                           weight: 0.40 },
  ],
  freight_invoice: [
    { patterns: ["freight invoice", "carrier invoice"],                   weight: 1.00 },
    { patterns: ["invoice #", "invoice number", "inv #", "invoice no"],  weight: 0.95 },
    { patterns: ["invoice date", "bill date", "billing date"],            weight: 0.85 },
    { patterns: ["amount due", "balance due", "total due"],               weight: 0.80 },
    { patterns: ["remit to", "remit payment", "payment address"],         weight: 0.75 },
    { patterns: ["freight charges", "line haul", "fuel surcharge"],       weight: 0.70 },
    { patterns: ["subtotal", "total amount", "net amount"],               weight: 0.55 },
    { patterns: ["payment terms", "due date", "net 30", "net 60"],       weight: 0.50 },
    { patterns: ["federal tax id", "ein", "vendor id"],                   weight: 0.45 },
  ],
  receipt: [
    { patterns: ["payment receipt", "cash receipt", "receipt of payment"], weight: 1.00 },
    { patterns: ["received payment", "amount received", "payment received"], weight: 0.90 },
    { patterns: ["check number", "check #", "ach payment"],               weight: 0.75 },
    { patterns: ["wire transfer", "ach transfer", "electronic funds"],    weight: 0.70 },
    { patterns: ["paid in full", "balance paid", "zero balance"],         weight: 0.75 },
    { patterns: ["payment date", "date paid", "transaction date"],        weight: 0.55 },
    { patterns: ["paid", "transaction id"],                               weight: 0.40 },
  ],
  other: [
    { patterns: ["miscellaneous", "general document", "attachment"],      weight: 0.30 },
  ],
};

/**
 * Compute per-type confidence scores from document text.
 * Returns a record of all types with their 0–1 confidence, plus
 * the winning type, its confidence, and the signals that fired.
 */
export function computeAllScores(text: string): {
  allScores: Record<string, number>;
  bestType:  string;
  bestScore: number;
  signals:   string[];
} {
  const lower = text.toLowerCase();
  const allScores: Record<string, number> = {};

  let bestType  = "other";
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [docType, groups] of Object.entries(ENHANCED_SIGNALS)) {
    let score   = 0;
    let maxPoss = 0;
    const matched: string[] = [];

    for (const group of groups) {
      maxPoss += group.weight;
      if (group.patterns.some(p => lower.includes(p))) {
        let w = group.weight;
        // Halve if negative signals present
        if (group.negative?.some(n => lower.includes(n))) w *= 0.5;
        score += w;
        matched.push(group.patterns[0]);
      }
    }

    const norm = maxPoss > 0 ? Math.min(score / maxPoss, 0.97) : 0;
    allScores[docType] = Math.round(norm * 1000) / 1000;

    if (norm > bestScore) {
      bestScore   = norm;
      bestType    = docType;
      bestSignals = matched;
    }
  }

  // Structural signals — boost scores based on document layout indicators
  if (/signature[\s\S]{0,200}(date|received)/i.test(text)) {
    allScores.proof_of_delivery = Math.min((allScores.proof_of_delivery ?? 0) + 0.08, 0.97);
  }
  if (/\$[\s\d,]+\.\d{2}/.test(text) && lower.includes("invoice")) {
    allScores.freight_invoice = Math.min((allScores.freight_invoice ?? 0) + 0.06, 0.97);
  }

  // Re-find best after boosts
  for (const [t, s] of Object.entries(allScores)) {
    if (s > bestScore) { bestScore = s; bestType = t; }
  }

  return { allScores, bestType, bestScore, signals: bestSignals };
}

// ─── OpenAI classifier ────────────────────────────────────────────────────────

const AI_SYSTEM_PROMPT = `You are an expert freight factoring document classifier. You receive the extracted text from a freight document and classify it into one of these types:

- rate_confirmation: Document confirming load rate/price between broker and carrier
- bill_of_lading: Shipping receipt listing freight details and terms
- proof_of_delivery: Signed document confirming delivery of freight
- lumper_receipt: Receipt for unloading/loading labor (lumper fees)
- freight_invoice: Invoice from carrier requesting payment for freight services
- receipt: Payment receipt confirming money received
- other: Any document that doesn't fit the above categories

Respond ONLY with a valid JSON object in this exact format:
{
  "docType": "rate_confirmation",
  "confidence": 0.94,
  "signals": ["rate confirmation header found", "agreed rate field present", "carrier signature block"],
  "reasoning": "Document has explicit 'Rate Confirmation' header with load details and agreed rate of $X",
  "allScores": {
    "rate_confirmation": 0.94,
    "bill_of_lading": 0.05,
    "proof_of_delivery": 0.02,
    "lumper_receipt": 0.00,
    "freight_invoice": 0.03,
    "receipt": 0.01,
    "other": 0.00
  }
}`;

async function callOpenAI(text: string): Promise<AIClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OPENAI_API_KEY");

  // Truncate text to ~3000 chars to stay within token limits
  const truncated = text.length > 3000
    ? text.slice(0, 1500) + "\n…[truncated]…\n" + text.slice(-1000)
    : text;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       "gpt-4o-mini",
      temperature: 0.1,
      max_tokens:  500,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user",   content: `Classify this freight document:\n\n${truncated}` },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: { code?: string; type?: string } };
    const code = String(error.error?.code ?? error.error?.type ?? "request_failed").replace(/[^a-z0-9_]/gi, "").slice(0, 80);
    throw new Error(`OpenAI classification failed (HTTP ${response.status}, code: ${code})`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content ?? "";

  // Parse JSON from the model response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("OpenAI response did not contain valid JSON");

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    docType:    parsed.docType    ?? "other",
    confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
    signals:    Array.isArray(parsed.signals) ? parsed.signals : [],
    reasoning:  parsed.reasoning  ?? "",
    allScores:  parsed.allScores  ?? {},
    model:      "gpt-4o-mini",
    source:     "ai",
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Classify a document using AI (if key available) or enhanced rules.
 *
 * @param text             - Extracted document text
 * @param rulesResult      - Optional existing rule-based result (used as context)
 */
export async function classifyDocumentAI(
  text: string,
  rulesResult?: ClassificationResult,
  options: { requireAI?: boolean } = {},
): Promise<AIClassificationResult> {
  // Try OpenAI first
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await callOpenAI(text);
      console.log(
        `[aiClassifier] OpenAI result: ${result.docType} (${Math.round(result.confidence * 100)}%)`,
      );
      return result;
    } catch (err: any) {
      if (options.requireAI) throw err;
      console.warn("[aiClassifier] OpenAI failed, falling back to enhanced rules:", err?.message);
    }
  }
  if (options.requireAI) throw new Error("OPENAI_API_KEY is not configured for GPT-4o-mini classification");

  // Enhanced rule-based fallback
  const { allScores, bestType, bestScore, signals } = computeAllScores(text);

  // Merge with the rule-based result — take whichever scored higher
  const ruleConfidence = rulesResult?.confidence ?? 0;
  const useRules = ruleConfidence > bestScore;

  return {
    docType:    useRules ? (rulesResult?.docType ?? bestType) : bestType,
    confidence: Math.max(bestScore, ruleConfidence),
    signals:    useRules ? (rulesResult?.signals ?? signals) : signals,
    reasoning:  "Classification based on signal pattern matching across document text.",
    allScores,
    model:      "enhanced-rules-v2",
    source:     "rules",
  };
}

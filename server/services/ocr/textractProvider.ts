import { AnalyzeExpenseCommand, AnalyzeDocumentCommand, DetectDocumentTextCommand, TextractClient, type AnalyzeExpenseCommandOutput } from "@aws-sdk/client-textract";
import { createHash } from "node:crypto";
import { classifyDocumentAI } from "../aiClassifier";
import { BOL_QUERIES, decodeQueries, INTAKE_QUERIES, normalizeIntakeType } from "./textractQueries";
import type { OcrProvider, OcrResult } from "./types";
import { fieldsFromText, mergeFields, parseAmount, parseServiceDate } from "./ocrFields";
import { renderPages } from "./renderPages";
import { timeOcrStage, timeOcrParsing } from "../ocrPipelineTiming";

export function decodeExpense(response: AnalyzeExpenseCommandOutput, docType: string): OcrResult {
  const expenses = response.ExpenseDocuments ?? [];
  const lines = expenses.flatMap(expense => expense.Blocks ?? []).filter(block => block.BlockType === "LINE");
  const text = lines.map(line => line.Text ?? "").join("\n");
  const confidences = lines.flatMap(line => line.Confidence == null ? [] : [line.Confidence / 100]);
  const summaries = expenses.flatMap(expense => expense.SummaryFields ?? []);
  const value = (...types: string[]) => {
    for (const type of types) {
      const field = summaries.find(field => field.Type?.Text === type && field.ValueDetection?.Text?.trim());
      if (field) return field.ValueDetection!.Text!.trim();
    }
  };
  const labeled = (pattern: RegExp) => summaries.find(field =>
    pattern.test(field.LabelDetection?.Text ?? ""))?.ValueDetection?.Text?.trim();
  const fields = fieldsFromText(text);
  fields.invoiceNumber = value("INVOICE_RECEIPT_ID") ?? fields.invoiceNumber;
  const explicitLoad = summaries.find(field => field.ValueDetection?.Text?.trim() && (
    ["LOAD_NUMBER", "LOAD_ID"].includes(field.Type?.Text ?? "") ||
    /^load\s*(?:number|id|no\.?|#)?\s*:?\s*$/i.test(field.LabelDetection?.Text ?? "")));
  const referenceLoad = summaries.find(field => field.ValueDetection?.Text?.trim() && (
    ["PO_NUMBER", "REFERENCE_NUMBER", "ORDER_NUMBER", "ORDER_ID"].includes(field.Type?.Text ?? "") ||
    /^(?:p\.?\s*o\.?|ref|reference|order)\s*(?:number|id|no\.?|#)?\s*:?\s*$/i.test(field.LabelDetection?.Text ?? "")));
  const selectedLoad = explicitLoad?.ValueDetection?.Text?.trim() ? explicitLoad :
    /^load\b/i.test(fields.loadNumberSourceLabel ?? "") ? null : referenceLoad;
  if (selectedLoad?.ValueDetection?.Text?.trim()) {
    const token = selectedLoad.ValueDetection.Text.trim().split(/\s/)[0];
    if (/^[A-Z0-9-]+$/i.test(token) && !/^(?:number|no|id|ref|order|load|po)$/i.test(token)) {
      fields.loadNumber = token.toUpperCase();
      fields.loadNumberSourceLabel = selectedLoad.LabelDetection?.Text?.trim() ??
        (selectedLoad === explicitLoad ? "Load Number" :
          selectedLoad.Type?.Text === "PO_NUMBER" ? text.match(/\bp\.?\s*o\.?\s*(?:number|#)/i)?.[0] ?? "P.O. Number" :
          selectedLoad.Type?.Text?.startsWith("ORDER") ? "Order #" : "Reference");
    }
  }
  fields.amount = parseAmount(value("TOTAL")) ?? fields.amount;
  // Vendor is the issuer, usually the carrier on invoices, NOT the broker.
  fields.brokerName = value("BROKER_NAME", "RECEIVER_NAME", "CUSTOMER_NAME") ?? fields.brokerName;
  if (!fields.brokerName && (docType === "rate_confirmation" || /(?:rate|load)\s+confirmation/i.test(text))) {
    fields.brokerName = value("VENDOR_NAME") ?? null;
  }
  fields.serviceDate = parseServiceDate(value("SERVICE_DATE", "DELIVERY_DATE") ??
    labeled(/^(?:service|delivery|pickup)\s*date\s*:?\s*$/i)) ?? fields.serviceDate;
  fields.invoiceDate = parseServiceDate(value("INVOICE_RECEIPT_DATE", "INVOICE_DATE") ??
    labeled(/^invoice\s*date\s*:?\s*$/i)) ?? fields.invoiceDate;
  fields.bolNumber = value("BOL_NUMBER") ?? labeled(/^(?:bol|b\/l|bill\s+of\s+lading)\s*(?:number|no\.?|#)?\s*:?\s*$/i) ?? fields.bolNumber;
  const fieldConfidences: Record<string, number> = {};
  const confidenceTypes: Record<string, string[]> = {
    invoiceNumber: ["INVOICE_RECEIPT_ID"], amount: ["TOTAL"],
    brokerName: ["BROKER_NAME", "RECEIVER_NAME", "CUSTOMER_NAME"],
    invoiceDate: ["INVOICE_RECEIPT_DATE", "INVOICE_DATE"],
    serviceDate: ["SERVICE_DATE", "DELIVERY_DATE"], bolNumber: ["BOL_NUMBER"],
  };
  for (const [key, types] of Object.entries(confidenceTypes)) {
    const field = summaries.find(field => types.includes(field.Type?.Text ?? "") && field.ValueDetection?.Text?.trim());
    if (field?.ValueDetection?.Confidence != null) fieldConfidences[key] = field.ValueDetection.Confidence / 100;
  }
  if (selectedLoad?.ValueDetection?.Confidence != null) fieldConfidences.loadNumber = selectedLoad.ValueDetection.Confidence / 100;
  if (Object.keys(fieldConfidences).length) fields.fieldConfidences = fieldConfidences;
  return {
    text, fields,
    confidence: confidences.length ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length : 0,
    raw: response,
  };
}

type ExpenseClient = Pick<TextractClient, "send">;
export class TextractProvider implements OcrProvider {
  readonly key = "textract";
  constructor(
    private readonly client: ExpenseClient = new TextractClient({
      region: process.env.OCR_AWS_REGION ?? "us-east-2", maxAttempts: 2,
    }),
    private readonly rasterize = renderPages,
    private readonly classify = classifyDocumentAI,
  ) {}

  async extract(fileBuffer: Buffer, mimeType: string, docType: string): Promise<OcrResult> {
    const pages = await timeOcrStage("Page Rendering", () => this.rasterize(fileBuffer, mimeType));
    let classification: Awaited<ReturnType<typeof classifyDocumentAI>> | undefined;
    let type = normalizeIntakeType(docType);
    if (["other", "auto"].includes(type)) {
      const classificationTexts: string[] = [];
      const classificationConfidence: number[] = [];
      for (const page of pages) {
        const initial = await timeOcrStage("Textract API Call", () => this.client.send(new DetectDocumentTextCommand({ Document: { Bytes: page } })));
        classificationTexts.push((initial.Blocks ?? []).filter(block => block.BlockType === "LINE").map(block => block.Text ?? "").join("\n"));
        const scores = (initial.Blocks ?? []).filter(block => block.BlockType === "LINE" && block.Confidence != null).map(block => block.Confidence! / 100);
        classificationConfidence.push(scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0);
      }
      const text = classificationTexts.join("\n\n");
      if (!text.trim()) throw new Error("Textract returned no text for intake classification");
      classification = await timeOcrStage("Claude Haiku Classification", () => this.classify(classificationTexts[0], undefined, { requireAI: true }));
      if (classification.source !== "ai") throw new Error("Claude intake classification unavailable; refusing to guess document type");
      type = normalizeIntakeType(classification.docType);
      if (!["invoice", "rate_confirmation", "bol", "pod"].includes(type)) {
        return { text, confidence: classificationConfidence.reduce((sum, value) => sum + value, 0) / classificationConfidence.length, fields: fieldsFromText(""),
          raw: { classification, docType: "other", pageCount: pages.length,
            fileSha256: createHash("sha256").update(fileBuffer).digest("hex"),
            pageResults: classificationTexts.map((text, index) => ({ text, confidence: classificationConfidence[index] })),
            operation: "DetectDocumentText", ignoredForIntake: true } };
      }
    }
    const results: OcrResult[] = [];
    for (const page of pages) {
      if (page.length > 5 * 1024 * 1024) throw new Error("OCR page exceeds Textract's 5 MB synchronous limit");
      if (type === "invoice") {
        const response = await timeOcrStage("Textract API Call", () => this.client.send(new AnalyzeExpenseCommand({ Document: { Bytes: page } })));
        results.push(timeOcrParsing(() => decodeExpense(response, type)));
      } else {
        const response = await timeOcrStage("Textract API Call", () => this.client.send(new AnalyzeDocumentCommand({
          Document: { Bytes: page }, FeatureTypes: ["QUERIES", "SIGNATURES"],
          QueriesConfig: { Queries: type === "rate_confirmation" ? INTAKE_QUERIES : BOL_QUERIES },
        })));
        results.push(timeOcrParsing(() => decodeQueries(response, type)));
      }
    }
    return {
      text: results.map(result => result.text).join("\n\n"),
      confidence: results.reduce((sum, result) => sum + result.confidence, 0) / results.length,
      fields: mergeFields(results.map(result => result.fields)),
      raw: { provider: this.key, region: process.env.OCR_AWS_REGION ?? "us-east-2", pageCount: pages.length,
        operation: type === "invoice" ? "AnalyzeExpense" : "AnalyzeDocument",
        docType: type, classification,
        fileSha256: createHash("sha256").update(fileBuffer).digest("hex"),
        pageResults: results.map(result => ({ text: result.text, confidence: result.confidence })),
        pages: results.map(result => result.raw) },
    };
  }
}

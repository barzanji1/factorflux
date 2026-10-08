import { AnalyzeExpenseCommand, TextractClient, type AnalyzeExpenseCommandOutput } from "@aws-sdk/client-textract";
import type { OcrProvider, OcrResult } from "./types";
import { fieldsFromText, mergeFields, parseAmount, parseServiceDate } from "./ocrFields";
import { renderPages } from "./renderPages";

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
  fields.loadNumber = value("LOAD_NUMBER", "LOAD_ID") ?? labeled(/^load\s*(?:number|id|no\.?|#)?\s*:?\s*$/i) ?? fields.loadNumber;
  fields.amount = parseAmount(value("TOTAL")) ?? fields.amount;
  // Vendor is the issuer, usually the carrier on invoices, NOT the broker.
  fields.brokerName = value("BROKER_NAME", "RECEIVER_NAME", "CUSTOMER_NAME") ?? fields.brokerName;
  if (!fields.brokerName && (docType === "rate_confirmation" || /(?:rate|load)\s+confirmation/i.test(text))) {
    fields.brokerName = value("VENDOR_NAME") ?? null;
  }
  fields.serviceDate = parseServiceDate(value("SERVICE_DATE", "DELIVERY_DATE") ??
    labeled(/^(?:service|delivery|pickup)\s*date\s*:?\s*$/i)) ?? fields.serviceDate;
  fields.bolNumber = value("BOL_NUMBER") ?? labeled(/^(?:bol|b\/l|bill\s+of\s+lading)\s*(?:number|no\.?|#)?\s*:?\s*$/i) ?? fields.bolNumber;
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
  ) {}

  async extract(fileBuffer: Buffer, mimeType: string, docType: string): Promise<OcrResult> {
    const pages = await this.rasterize(fileBuffer, mimeType);
    const results: OcrResult[] = [];
    for (const page of pages) {
      if (page.length > 5 * 1024 * 1024) throw new Error("OCR page exceeds Textract's 5 MB synchronous limit");
      const response = await this.client.send(new AnalyzeExpenseCommand({ Document: { Bytes: page } }));
      results.push(decodeExpense(response, docType));
    }
    return {
      text: results.map(result => result.text).join("\n\n"),
      confidence: results.reduce((sum, result) => sum + result.confidence, 0) / results.length,
      fields: mergeFields(results.map(result => result.fields)),
      raw: { provider: this.key, region: process.env.OCR_AWS_REGION ?? "us-east-2", pageCount: pages.length,
        pageResults: results.map(result => ({ text: result.text, confidence: result.confidence })),
        pages: results.map(result => result.raw) },
    };
  }
}

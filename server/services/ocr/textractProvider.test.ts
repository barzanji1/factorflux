import test from "node:test";
import assert from "node:assert/strict";
import { AnalyzeExpenseCommand, type AnalyzeExpenseCommandOutput } from "@aws-sdk/client-textract";
import { TextractProvider, decodeExpense } from "./textractProvider";
import { OcrExtractionAdapter } from "./registry";
import { fieldsFromText } from "./ocrFields";
import type { OcrProvider } from "./types";

const expense: AnalyzeExpenseCommandOutput = {
  $metadata: {},
  ExpenseDocuments: [{
    Blocks: [{ BlockType: "LINE", Text: "Invoice Number: INV-9001", Confidence: 99 },
      { BlockType: "LINE", Text: "Load ID LD-777\nService Date: 10/08/2026\nBOL # BOL-111", Confidence: 97 }],
    SummaryFields: [
      { Type: { Text: "INVOICE_RECEIPT_ID" }, ValueDetection: { Text: "INV-9001" } },
      { Type: { Text: "TOTAL" }, ValueDetection: { Text: "$1,250.00" } },
      { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: "Carrier LLC" } },
      { Type: { Text: "RECEIVER_NAME" }, ValueDetection: { Text: "Broker Logistics" } },
    ],
  }],
};
test("AnalyzeExpense maps all six fields without treating invoice vendor as broker", () => {
  const result = decodeExpense(expense, "invoice");
  assert.equal(result.confidence, .98);
  assert.deepEqual(result.fields, {
    invoiceNumber: "INV-9001", loadNumber: "LD-777", amount: 1250,
    brokerName: "Broker Logistics", serviceDate: "2026-10-08", bolNumber: "BOL-111",
    loadNumberSourceLabel: "Load ID", invoiceDate: null,
  });
});
test("Textract analyzes every rasterized page and merges fields", async () => {
  let calls = 0;
  const provider = new TextractProvider({
    send: async (command: AnalyzeExpenseCommand) => {
      assert.ok(command.input.Document?.Bytes);
      calls++;
      return expense;
    },
  } as never, async () => [Buffer.from("page1"), Buffer.from("page2")]);
  const result = await provider.extract(Buffer.from("pdf"), "application/pdf", "invoice");
  assert.equal(calls, 2);
  assert.equal((result.raw as { pageCount: number }).pageCount, 2);
  assert.equal(result.fields.invoiceNumber, "INV-9001");
});
test("adapter never uses fallback to hide a thrown provider error", async () => {
  let fallbackCalls = 0;
  const primary: OcrProvider = { key: "textract", extract: async () => { throw new Error("Access denied"); } };
  const fallback: OcrProvider = { key: "tesseract_ocr", extract: async () => {
    fallbackCalls++; return { text: "fallback", fields: fieldsFromText(""), confidence: .9, raw: {} };
  } };
  await assert.rejects(new OcrExtractionAdapter(primary, fallback).extractText(
    "uploads/a7a4b423fdd5abff1900a2f918dfb631.pdf", "application/pdf"), /Access denied/);
  assert.equal(fallbackCalls, 0);
});
test("text-empty cloud response can use corrected Tesseract fallback with provenance", async () => {
  const primary: OcrProvider = { key: "textract", extract: async () => ({
    text: "", fields: fieldsFromText(""), confidence: 0, raw: {},
  }) };
  const fallback: OcrProvider = { key: "tesseract_ocr", extract: async () => ({
    text: "Invoice # INV-9012", fields: fieldsFromText("Invoice # INV-9012"), confidence: .9,
    raw: { pageCount: 1, pages: [{ text: "Invoice # INV-9012", confidence: .9 }] },
  }) };
  const result = await new OcrExtractionAdapter(primary, fallback).extractText(
    "uploads/a7a4b423fdd5abff1900a2f918dfb631.pdf", "application/pdf");
  assert.equal(result.providerKey, "tesseract_ocr");
  assert.equal(result.fields?.invoiceNumber, "INV-9012");
  assert.equal((result.raw as { fallbackReason: string }).fallbackReason, "empty_cloud_text");
});

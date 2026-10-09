import test from "node:test";
import assert from "node:assert/strict";
import { fieldsFromText, mergeFields } from "./ocrFields";
import { decodeExpense } from "./textractProvider";
import { extractLoadNumber } from "../documentFieldDetectors";

for (const label of ["P.O. Number", "PO #", "Ref #", "Reference", "Order #"]) {
  test(`load fallback records ${label}`, () => {
    const result = extractLoadNumber(`${label} 150611\nOther field`);
    assert.equal(result?.normalized, "150611");
    assert.equal(result?.sourceLabel, label);
    assert.equal(extractLoadNumber(`${label} 150611\nLoad # LD-1`)?.normalized, "LD-1");
    assert.equal(extractLoadNumber(`Load # LD-1\n${label} 150611`)?.normalized, "LD-1");
  });
}
test("invoice date stays separate; no service date is invented", () => {
  const result = fieldsFromText("Invoice Date: 09/25/2026\nP.O. Number 150611");
  assert.equal(result.invoiceDate, "2026-09-25");
  assert.equal(result.serviceDate, null);
  assert.equal(fieldsFromText("Date: 09/25/2026").serviceDate, null);
  assert.equal(fieldsFromText("Invoice Date: 02/30/2026").invoiceDate, null);
});
test("postal PO Box addresses never become load identifiers", () => {
  assert.equal(extractLoadNumber("PO BOX 150523"), null);
  assert.equal(extractLoadNumber("PO BOX 150523\nP.O. Number 150611")?.normalized, "150611");
});
test("instruction prose on later pages never overrides a real load identifier", () => {
  const result = mergeFields([
    { ...fieldsFromText("Load #150611"), loadNumberSourceLabel: "Textract load-number query" },
    fieldsFromText("You must report issues with this load\nIF an accident happens"),
  ]);
  assert.equal(result.loadNumber, "150611");
});
test("positive signature confidence is not inflated by an earlier confident negative answer", () => {
  const result = mergeFields([
    { ...fieldsFromText(""), receiverSignature: false, fieldConfidences: { receiverSignature: .99 } },
    { ...fieldsFromText(""), receiverSignature: true, fieldConfidences: { receiverSignature: .8 } },
  ]);
  assert.equal(result.receiverSignature, true);
  assert.equal(result.fieldConfidences?.receiverSignature, .8);
});
test("structured PO header and invoice date map without relying on adjacent OCR lines", () => {
  const result = decodeExpense({ $metadata: {}, ExpenseDocuments: [{
    Blocks: [{ BlockType: "LINE", Text: "P.O. Number\nShip\n150611", Confidence: 99 }],
    SummaryFields: [
      { Type: { Text: "PO_NUMBER" }, LabelDetection: { Text: "P.O. Number" }, ValueDetection: { Text: "150611" } },
      { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "09/25/2026" } },
    ],
  }] }, "invoice");
  assert.equal(result.fields.loadNumber, "150611");
  assert.equal(result.fields.loadNumberSourceLabel, "P.O. Number");
  assert.equal(result.fields.invoiceDate, "2026-09-25");
  assert.equal(result.fields.serviceDate, null);
});
test("explicit load beats a structured PO reference and keeps its label", () => {
  const result = decodeExpense({ $metadata: {}, ExpenseDocuments: [{
    Blocks: [{ BlockType: "LINE", Text: "Load # LD-1", Confidence: 99 }],
    SummaryFields: [
      { Type: { Text: "PO_NUMBER" }, LabelDetection: { Text: "P.O. Number" }, ValueDetection: { Text: "150611" } },
    ],
  }] }, "invoice");
  assert.equal(result.fields.loadNumber, "LD-1");
  assert.equal(result.fields.loadNumberSourceLabel, "Load #");
});
test("a later-page explicit load beats an earlier-page reference", () => {
  const merged = mergeFields([fieldsFromText("P.O. Number 150611"), fieldsFromText("Load # LD-2")]);
  assert.equal(merged.loadNumber, "LD-2");
  assert.equal(merged.loadNumberSourceLabel, "Load #");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mapIntakeDocuments, intakeTolerance, type IntakeDocument } from "./ocrIntakeMapping";
import { reusableIntakePaperwork } from "./ocrIntakePaperwork";
import { createHash } from "node:crypto";
const doc = (id: number, type: string, fields: Record<string, string>): IntakeDocument => ({
  documentId: id, filename: `${type}.pdf`, docType: type, fields, fieldConfidences: { rate: .95 },
  confidence: .9, status: "completed",
});
const rate = doc(1, "rate_confirmation", { broker_name: "Rate Broker", load_number: "150611", rate: "250",
  pickup_date: "2026-09-23", delivery_date: "2026-09-24", origin: "Stoughton, MA", destination: "Natick, MA" });
const invoice = doc(2, "invoice", { invoice_number: "9", broker_name: "Wrong Invoice Broker", load_number: "150611",
  amount: "250", invoice_date: "2026-09-25" });
const bol = doc(3, "bol", { delivery_date: "2026-09-25", bol_number: "BOL-55", pod_signature: "true" });
test("rate, invoice and BOL field precedence preserves each document source and confidence", () => {
  const result = mapIntakeDocuments([bol, invoice, rate], 0);
  assert.equal(result.fields.broker_name, "Rate Broker");
  assert.equal(result.fields.load_number, "150611");
  assert.equal(result.fields.amount, "250");
  assert.equal(result.fields.rate, "250");
  assert.equal(result.fields.delivery_date, "2026-09-25");
  assert.equal(result.sources.broker_name.documentId, 1);
  assert.equal(result.sources.invoice_number.documentId, 2);
  assert.equal(result.sources.delivery_date.documentId, 3);
  assert.equal(result.sources.rate.confidence, .95);
  assert.equal(result.fields.service_date, undefined);
  assert.deepEqual(result.alerts, []);
});
test("all four cross-check codes fire with their required severities", () => {
  const result = mapIntakeDocuments([rate, { ...invoice, fields: { ...invoice.fields, amount: "255", load_number: "OTHER" } },
    { ...bol, fields: { ...bol.fields, delivery_date: "2026-09-26", pod_signature: "false" } }], 0);
  assert.deepEqual(result.alerts.map(alert => [alert.code, alert.severity]),
    [["RATE_MISMATCH", "ack"], ["LOAD_MISMATCH", "ack"], ["DELIVERY_AFTER_INVOICE", "ack"], ["NO_SIGNATURE", "info"]]);
});
test("rate tolerance is cent-exact and inclusive, default zero", () => {
  assert.equal(intakeTolerance("0"), 0);
  const changed = { ...invoice, fields: { ...invoice.fields, amount: "250.01" } };
  assert.equal(mapIntakeDocuments([rate, changed, bol], 0).alerts[0].code, "RATE_MISMATCH");
  assert.equal(mapIntakeDocuments([rate, changed, bol], .01).alerts.length, 0);
  for (const bad of ["-1", "NaN", "abc", "", "1.001", "Infinity"]) assert.throws(() => intakeTolerance(bad));
});
test("missing dates are not inferred and multiple documents per type are accepted", () => {
  const duplicates = mapIntakeDocuments([rate, { ...rate, documentId: 4 },
    invoice, { ...invoice, documentId: 5 }, bol, { ...bol, documentId: 6 }], 0);
  assert.equal(duplicates.sources.rate.documentId, rate.documentId);
  assert.equal(duplicates.sources.invoice_number.documentId, invoice.documentId);
  assert.equal(duplicates.sources.bol_number.documentId, bol.documentId);
  assert.deepEqual(duplicates.missingTypes, []);
  const result = mapIntakeDocuments([invoice], 0);
  assert.equal(result.fields.delivery_date, undefined);
  assert.equal(result.fields.pickup_date, undefined);
  assert.equal(result.fields.invoice_date, "2026-09-25");
  assert.equal(result.alerts.length, 0);
  assert.deepEqual(result.missingTypes, ["rate_confirmation", "bol"]);
});
test("failed documents never supply fields; signature words do not clear missing-signature alert", () => {
  const result = mapIntakeDocuments([{ ...rate, status: "failed" }, invoice,
    { ...bol, fields: { ...bol.fields, pod_signature: "signature" } }], 0);
  assert.equal(result.sources.load_number.documentId, 2);
  assert.equal(result.alerts[0].code, "NO_SIGNATURE");
});
test("BOL_MISMATCH combines route and visible shipment-reference differences into one ack alert", () => {
  const wrongBol = { ...bol, fields: { ...bol.fields, origin: "Schenectady, NY", destination: "Franklin, GA",
    load_number: "202615480", load_number_label: "Shipment ID" } };
  const result = mapIntakeDocuments([rate, invoice, wrongBol], 0);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].code, "BOL_MISMATCH");
  assert.equal(result.alerts[0].severity, "ack");
  for (const detail of ["origin", "destination", "150611", "202615480", "rate_confirmation.pdf", "bol.pdf"]) {
    assert(result.alerts[0].message.includes(detail));
  }
});
test("each BOL mismatch criterion independently requires acknowledgement", () => {
  for (const changed of [
    { origin: "Schenectady, NY" }, { destination: "Franklin, GA" },
    { load_number: "202615480", load_number_label: "Load #" },
  ]) {
    const result = mapIntakeDocuments([rate, invoice, { ...bol, fields: { ...bol.fields, ...changed } }], 0);
    assert.equal(result.alerts[0].code, "BOL_MISMATCH");
    assert.equal(result.alerts[0].severity, "ack");
  }
});
test("matching routes/references tolerate formatting; missing evidence and independent BOL numbers do not mismatch", () => {
  const result = mapIntakeDocuments([rate, invoice, { ...bol, fields: { ...bol.fields,
    origin: "stoughton, Massachusetts 02072", destination: "NATICK Massachusetts",
    load_number: "*150611*", load_number_label: "Shipment ID" } }], 0);
  assert.deepEqual(result.alerts, []);
  for (const extra of [
    { bol_number: "999999" },
    { load_number: "999999", load_number_label: "Textract load-number query" },
    { origin: "unknown", destination: "" },
  ]) {
    assert.deepEqual(mapIntakeDocuments([rate, invoice, { ...bol, fields: { ...bol.fields, ...extra } }], 0).alerts, []);
  }
});
test("paperwork reuse requires exact content hash; explicit slots can override type but cannot steal documents", () => {
  const buffer = Buffer.from("%PDF-fixture");
  const source = { ...rate, contentHash: createHash("sha256").update(buffer).digest("hex") };
  const files = { rateConfirmation: [{ buffer } as Express.Multer.File] };
  assert.equal(reusableIntakePaperwork(files, [source]).get("rateConfirmation"), 1);
  assert.equal(reusableIntakePaperwork(files, [{ ...source, contentHash: "other" }]).size, 0);
  assert.equal(reusableIntakePaperwork(files, [{ ...source, docType: "invoice" }]).get("rateConfirmation"), 1);
  assert.throws(() => reusableIntakePaperwork(files, [{ ...source, invoiceId: 8 }]), /already attached/);
});
test("every file in multi-file slots reuses its own intake document without uploading it again", () => {
  const buffer = Buffer.from("%PDF-fixture");
  const corrected = Buffer.from("%PDF-corrected");
  const source = { ...invoice, contentHash: createHash("sha256").update(buffer).digest("hex") };
  const correction = { ...invoice, documentId: 9, contentHash: createHash("sha256").update(corrected).digest("hex") };
  const files = { carrierInvoice: [{ buffer }, { buffer: corrected }] as Express.Multer.File[] };
  const reused = reusableIntakePaperwork(files, [source, correction]);
  assert.equal(reused.get("carrierInvoice"), invoice.documentId);
  assert.equal(reused.get("carrierInvoice:1"), 9);
  assert.equal(reused.size, 2);
});
test("generic supporting slots preserve any existing OCR classification when reused", () => {
  const buffer = Buffer.from("%PDF-generic-pod");
  const source = { ...bol, docType: "pod", contentHash: createHash("sha256").update(buffer).digest("hex") };
  const reused = reusableIntakePaperwork({ other: [{ buffer } as Express.Multer.File] }, [source]);
  assert.equal(reused.get("other"), bol.documentId);
});

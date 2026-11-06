import test from "node:test";
import assert from "node:assert/strict";
import { filenameDocumentType, presetDocumentClassification } from "./documentTypeHints";

test("filename categories include lumper receipts and every requested filename convention", () => {
  for (const [name, expected] of [
    ["LUMPER-0556271.pdf", "lumper_receipt"], ["scanned_LuMpEr_receipt.PDF", "lumper_receipt"],
    ["BOL150611.pdf", "bill_of_lading"], ["Rate Con 150611.pdf", "rate_confirmation"],
    ["rate_confirmation_150611.pdf", "rate_confirmation"], ["RC-150611.pdf", "rate_confirmation"],
    ["INVOICE-150611.pdf", "freight_invoice"], ["POD150611.pdf", "proof_of_delivery"],
    ["Signed Release.pdf", "release_letter"], ["carrier-NOA-signed.pdf", "noa"],
    ["weight ticket 150611.pdf", "weight_ticket"], ["weight_ticket-150611.pdf", "weight_ticket"],
    ["dispatch-sheet.pdf", "dispatch_sheet"],
  ]) assert.equal(filenameDocumentType(name), expected, name);
  for (const name of ["scan123.pdf", "symbol.pdf", "podium.pdf", "noah.pdf"]) {
    assert.equal(filenameDocumentType(name), null, name);
  }
});

test("a typed agent slot overrides even a conflicting filename; generic slots still allow filename hints", () => {
  const result = presetDocumentClassification({
    originalName: "INVOICE-5.pdf", classificationSource: "agent",
    finalDocumentType: "lumper_receipt", documentType: "other",
  });
  assert.equal(result?.docType, "lumper_receipt");
  assert.equal(result?.model, "agent-slot");
  assert.equal(presetDocumentClassification({ originalName: "LUMPER-0556271.pdf", documentType: "other" })?.docType, "lumper_receipt");
  assert.equal(presetDocumentClassification({ originalName: "scan.pdf", documentType: "other" }), null);
  assert.equal(presetDocumentClassification({ originalName: "LUMPER-5.pdf", classificationSource: "agent", documentType: "other" })?.docType, "lumper_receipt");
});

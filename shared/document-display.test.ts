import test from "node:test";
import assert from "node:assert/strict";
import { documentClassification, documentClassificationLabel } from "./document-display";

test("both document pages use AI classification unless a human explicitly overrides it", () => {
  const doc = { documentType: "other", candidateDocumentType: "freight_invoice", aiDocumentType: "freight_invoice" };
  assert.equal(documentClassification(doc), "freight_invoice");
  assert.equal(documentClassificationLabel(documentClassification(doc)), "Freight Invoice");
  assert.equal(documentClassification({ ...doc, finalDocumentType: "other" }), "freight_invoice");
  assert.equal(documentClassification({ ...doc, finalDocumentType: "other", classificationSource: "agent" }), "other");
  assert.equal(documentClassification({ ...doc, candidateDocumentType: "other" }), "freight_invoice");
  assert.equal(documentClassification({ documentType: "bol" }), "bol");
  assert.equal(documentClassificationLabel("bill_of_lading"), documentClassificationLabel("bol"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { documentClassification, documentClassificationLabel } from "./document-display";

test("both document pages use reviewed classification first, then AI candidate, then legacy type", () => {
  const doc = { documentType: "other", candidateDocumentType: "freight_invoice", aiDocumentType: "freight_invoice" };
  assert.equal(documentClassification(doc), "freight_invoice");
  assert.equal(documentClassificationLabel(documentClassification(doc)), "Freight Invoice");
  assert.equal(documentClassification({ ...doc, finalDocumentType: "other" }), "other");
  assert.equal(documentClassification({ documentType: "bol" }), "bol");
  assert.equal(documentClassificationLabel("bill_of_lading"), documentClassificationLabel("bol"));
});

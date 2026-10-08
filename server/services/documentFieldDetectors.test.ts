import assert from "node:assert/strict";
import test from "node:test";
import { extractInvoiceNumber, extractLoadNumber, extractReferenceNumber, extractBolNumber } from "./documentFieldDetectors";

const labels = [
  ["Invoice #", extractInvoiceNumber],
  ["Invoice No.", extractInvoiceNumber],
  ["Invoice Number:", extractInvoiceNumber],
  ["INV#", extractInvoiceNumber],
  ["Inv:", extractInvoiceNumber],
  ["Load #", extractLoadNumber],
  ["Load Number", extractLoadNumber],
  ["Load ID", extractLoadNumber],
  ["PRO #", extractReferenceNumber],
  ["Ref #", extractReferenceNumber],
  ["BOL #", extractReferenceNumber],
] as const;

for (const [label, detect] of labels) {
  test(`${label}: extracts only the alphanumeric/hyphen value`, () => {
    assert.equal(detect(`${label} INV-9001 Next field`)?.value, "INV-9001");
    assert.equal(detect(`${label} ab-90-X\nNext field`)?.value, "ab-90-X");
    assert.equal(detect(`${label}\nABC-123\nAmount: $1500`)?.normalized, "ABC-123");
    assert.equal(detect(`${label} 9001`)?.value, "9001");
    assert.equal(detect(`${label} ABC`)?.value, "ABC");
  });
  test(`${label}: missing values never become label words`, () => {
    assert.equal(detect(label), null);
    assert.equal(detect(`${label}\nLoad Number: LD-1`)?.value ?? null,
      label.startsWith("Load") ? "LD-1" : null);
    for (const word of ["NUMBER", "NO", "NUM", "ID", "INVOICE", "INV", "LOAD", "REF", "PRO", "BOL"]) {
      assert.equal(detect(`${label} ${word}`), null, word);
    }
  });
}

test("original failing example returns the invoice identifier, not NUMBER", () => {
  assert.deepEqual(extractInvoiceNumber("Invoice Number: INV-9001"), {
    value: "INV-9001", normalized: "INV-9001", confidence: 0.8,
  });
});

test("a missing first value does not hide a later valid label", () => {
  assert.equal(extractInvoiceNumber("Invoice Number:\nInvoice # INV-2")?.value, "INV-2");
});

test("label matching is case-insensitive and does not match inside other words", () => {
  assert.equal(extractLoadNumber("lOaD iD: LD-9")?.value, "LD-9");
  assert.equal(extractInvoiceNumber("Reinvoice # INV-9"), null);
  assert.equal(extractLoadNumber("Upload Number: LD-9"), null);
  assert.equal(extractInvoiceNumber("INV-9001"), null);
});

test("reference identifiers remain distinct from invoice and load numbers", () => {
  for (const label of ["PRO #", "Ref #", "BOL #"]) {
    assert.equal(extractLoadNumber(`${label} ABC-9`), null);
    assert.equal(extractInvoiceNumber(`${label} ABC-9`), null);
    assert.equal(extractReferenceNumber(`${label} ABC-9`)?.value, "ABC-9");
  }
});

test("BOL's separate field uses the same safe label/value handling", () => {
  assert.equal(extractBolNumber("BOL # BOL-77")?.value, "BOL-77");
  assert.equal(extractBolNumber("Bill of Lading Number: BL-77")?.value, "BL-77");
  assert.equal(extractBolNumber("B/L No. BL-77")?.value, "BL-77");
  assert.equal(extractBolNumber("BOL Number:"), null);
  assert.equal(extractBolNumber("BOL # NUMBER"), null);
});

test("invalid value characters do not become truncated identifiers", () => {
  assert.equal(extractInvoiceNumber("Invoice # B/L"), null);
  assert.equal(extractInvoiceNumber("Invoice # INV_9001"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { getIntakeSnapshot, parseIntakeIds } from "./ocrIntakeSnapshot";
import { documents, docExtractionJobs, docExtractionResults, docFieldCandidates } from "../../shared/schema";
function fakeDatabase(status = "completed", owner = "owner") {
  const doc = { id: 1, uploadedBy: owner, originalName: "carrier.pdf", documentType: "invoice", invoiceId: null };
  const job = { id: 2, documentId: 1, status, errorMessage: status === "failed" ? "OCR failed" : null };
  const rows = new Map<unknown, unknown[]>([
    [documents, [doc]], [docExtractionJobs, [job]],
    [docExtractionResults, [{ documentId: 1, jobId: 2, confidenceScore: ".95",
      rawPayloadJson: { fields: { invoiceNumber: "9", amount: null, brokerName: null, invoiceDate: "2026-09-25" },
        providerRaw: { docType: "invoice" } } }]],
    [docFieldCandidates, [{ fieldName: "amount", normalizedValue: "999", confidenceScore: ".99" },
      { fieldName: "broker_id", normalizedValue: "777", confidenceScore: "1" }]],
  ]);
  return {
    select: () => {
      let table: unknown;
      const chain = { from: (value: unknown) => { table = value; return chain; },
        where: () => chain, limit: () => chain, orderBy: () => chain,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows.get(table) ?? []).then(resolve) };
      return chain;
    },
    execute: async () => { throw new Error("Unknown broker names must not query or create brokers"); },
  };
}
test("latest structured unknown fields erase stale candidates and broker IDs", async () => {
  const result = await getIntakeSnapshot([1], { id: "owner", role: "employee" }, fakeDatabase() as any);
  assert.equal(result.fields.amount, undefined);
  assert.equal(result.fields.broker_id, undefined);
  assert.equal(result.fields.invoice_number, "9");
  assert.equal(result.fields.invoice_date, "2026-09-25");
  assert.equal(result.fields.service_date, undefined);
});
test("failed latest job cannot return old successful fields", async () => {
  const result = await getIntakeSnapshot([1], { id: "owner", role: "employee" }, fakeDatabase("failed") as any);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "OCR failed");
  assert.deepEqual(result.fields, {});
});
test("intake snapshot enforces staff document ownership before reading extraction", async () => {
  await assert.rejects(getIntakeSnapshot([1], { id: "other", role: "employee" }, fakeDatabase() as any), /your own/);
});
test("intake ID validation rejects duplicates, malformed values and oversized sets", () => {
  assert.deepEqual(parseIntakeIds([1, 2]), [1, 2]);
  for (const bad of [[1, 1], ["1"], [0], [1.1], Array.from({ length: 9 }, (_, index) => index + 1)]) {
    assert.throws(() => parseIntakeIds(bad));
  }
});

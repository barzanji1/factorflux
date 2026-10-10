import test from "node:test";
import assert from "node:assert/strict";
import { runExtractionJob } from "./documentExtraction";
import { docExtractionJobs, docFieldCandidates, documents } from "../../shared/schema";
import type { ExtractionProvider } from "./ocr/types";

for (const mode of ["throw", "empty", "native_fallback"] as const) {
  test(`OCR ${mode}: job fails with an error, never completes or writes candidates`, async () => {
    const writes: { table: unknown; values: Record<string, unknown> }[] = [];
    const database = {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => { writes.push({ table, values }); },
        }),
      }),
      insert: () => { assert.fail("Failed OCR must not write extraction results or fields"); },
    };
    const provider: ExtractionProvider = {
      key: "failing_test_provider", displayName: "Failing test provider",
      extractText: async () => {
        if (mode === "throw") throw new Error("Textract access denied");
        return {
          fullText: mode === "empty" ? "" : "-- 1 of 1 --",
          mainText: "", method: mode === "empty" ? "ocr_error" : "native_pdf_low_confidence",
          confidence: .25, pageTexts: [], pageCount: 1, providerKey: "failing_test_provider",
        };
      },
    };
    await runExtractionJob(101, 202, "/unused.pdf", "application/pdf", {
      database: database as never, provider,
    });
    const jobWrites = writes.filter(write => write.table === docExtractionJobs);
    assert.equal(jobWrites.at(-1)?.values.status, "failed");
    assert.match(String(jobWrites.at(-1)?.values.errorMessage),
      mode === "throw" ? /Textract access denied/ : /no usable result/);
    assert.ok(!jobWrites.some(write => write.values.status === "completed"));
    assert.equal(writes.find(write => write.table === documents)?.values.status, "failed");
  });
}

test("Claude API failure after successful OCR visibly fails the job and document, with no field candidates", async context => {
  context.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Fixture classifier error" } }),
    { status: 429, headers: { "content-type": "application/json" } },
  ));
  const writes: { table: unknown; values: any }[] = [];
  const database = {
    update: (table: unknown) => ({
      set: (values: any) => ({ where: async () => { writes.push({ table, values }); } }),
    }),
    insert: (table: unknown) => ({
      values: async (values: any) => { writes.push({ table, values }); },
    }),
  };
  const provider: ExtractionProvider = {
    key: "textract", displayName: "Textract fixture",
    extractText: async () => ({
      fullText: "INVOICE #9\nAmount: 250", mainText: "INVOICE #9\nAmount: 250",
      method: "textract_ocr", confidence: .99, pageTexts: ["INVOICE #9\nAmount: 250"],
      pageCount: 1, providerKey: "textract",
    }),
  };
  await runExtractionJob(101, 202, "/unused.pdf", "application/pdf", { database: database as never, provider });
  const jobWrites = writes.filter(write => write.table === docExtractionJobs);
  assert.equal(jobWrites.at(-1)?.values.status, "failed");
  assert.match(jobWrites.at(-1)?.values.errorMessage, /Claude.*HTTP 429/);
  assert.equal(writes.filter(write => write.table === documents).at(-1)?.values.status, "failed");
  assert.ok(!jobWrites.some(write => write.values.status === "completed"));
  assert.ok(!writes.some(write => write.table === docFieldCandidates));
});

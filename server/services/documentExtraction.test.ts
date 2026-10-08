import test from "node:test";
import assert from "node:assert/strict";
import { runExtractionJob } from "./documentExtraction";
import { docExtractionJobs, documents } from "../../shared/schema";
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

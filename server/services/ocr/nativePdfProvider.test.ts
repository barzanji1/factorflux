import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { NativePdfProvider } from "./nativePdfProvider";

test("native extraction works with the installed parser API and releases resources", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "native-pdf-regression-"));
  try {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    const complete = new Promise<Buffer>((resolve, reject) => {
      document.on("data", chunk => chunks.push(chunk));
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);
    });
    document.text("Native PDF extraction regression check. This document contains enough readable text to confirm that real extraction succeeds.");
    document.end();
    const file = path.join(directory, "fixture.pdf");
    writeFileSync(file, await complete);
    const result = await new NativePdfProvider().extractText(file, "application/pdf");
    assert.match(result.mainText, /Native PDF extraction regression check/);
    assert.equal(result.pageCount, 1);
    assert.equal(result.pageTexts.length, 1);
    assert.equal(result.confidence, 0.9);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * ocr/nativePdfProvider.ts
 * ──────────────────────────────────────────────────────────────────────────
 * ExtractionProvider that uses pdf-parse to pull native text from digital
 * (born-digital) PDFs.  Falls back to an empty result for image-only PDFs
 * rather than throwing — the caller (hybridProvider) decides whether to
 * escalate to OCR.
 */

import fs from "fs";
import type { ExtractionProvider, ExtractionResult, PageResult } from "./types";

const NATIVE_CONFIDENCE = 0.9;
const LOW_CONFIDENCE    = 0.4;
const LOW_TEXT_THRESHOLD = 50;   // chars per page considered "sparse"

function splitByFormFeed(text: string, pageCount: number): string[] {
  const ff = text.split("\x0c");
  if (ff.length === pageCount) return ff;
  const chunkSize = Math.ceil(text.length / Math.max(pageCount, 1));
  const chunks: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    chunks.push(text.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  return chunks;
}

export class NativePdfProvider implements ExtractionProvider {
  readonly key         = "native_pdf";
  readonly displayName = "pdf-parse (native PDF text)";

  async extractText(filePath: string, mimeType: string): Promise<ExtractionResult> {
    const isPdf =
      mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return this.empty("not_applicable");
    }

    try {
      const { PDFParse } = await import("pdf-parse");
      const buffer   = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: buffer });
      let data;
      try {
        data = await parser.getText();
      } finally {
        await parser.destroy();
      }
      const rawPages = data.pages.map(page => page.text);

      const fullText  = data.text ?? "";
      const pageCount = data.total ?? Math.max(rawPages.length, 1);
      const sources   = rawPages.length > 0
        ? rawPages
        : splitByFormFeed(fullText, pageCount);

      const pageTexts: PageResult[] = sources.map((t, i) => ({
        page:       i + 1,
        text:       t,
        method:     "native_pdf",
        confidence: t.trim().length > LOW_TEXT_THRESHOLD ? NATIVE_CONFIDENCE : LOW_CONFIDENCE,
      }));

      const mainText = fullText.replace(/\s+/g, " ").trim();

      return {
        fullText,
        mainText,
        method:      "native_pdf",
        confidence:  mainText.length > LOW_TEXT_THRESHOLD ? NATIVE_CONFIDENCE : LOW_CONFIDENCE,
        pageTexts,
        pageCount,
        providerKey: this.key,
      };
    } catch (err: any) {
      console.warn(`[${this.key}] pdf-parse failed:`, err?.message);
      return this.empty("native_pdf_error");
    }
  }

  private empty(method: string): ExtractionResult {
    return {
      fullText:    "",
      mainText:    "",
      method,
      confidence:  0,
      pageTexts:   [],
      pageCount:   0,
      providerKey: this.key,
    };
  }
}

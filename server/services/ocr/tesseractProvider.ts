/**
 * ocr/tesseractProvider.ts
 * ──────────────────────────────────────────────────────────────────────────
 * ExtractionProvider that uses Tesseract.js to OCR images and image-based
 * PDFs.  Works on any file type; the caller chooses when to invoke it.
 *
 * Future upgrade path: replace the `recognize` call with a call to a
 * cloud OCR API (Google Vision, AWS Textract, Azure AI) while keeping
 * this class's public interface identical.
 */

import type { ExtractionProvider, ExtractionResult, PageResult } from "./types";

export class TesseractProvider implements ExtractionProvider {
  readonly key         = "tesseract_ocr";
  readonly displayName = "Tesseract.js (open-source OCR)";

  async extractText(filePath: string, _mimeType: string): Promise<ExtractionResult> {
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(filePath, "eng", { logger: () => {} });

      const text       = result.data.text ?? "";
      const confidence = (result.data.confidence ?? 0) / 100;
      const mainText   = text.replace(/\s{3,}/g, "\n\n").trim();

      const pageTexts: PageResult[] = [
        {
          page:       1,
          text,
          method:     "image_ocr",
          confidence,
        },
      ];

      return {
        fullText:    text,
        mainText,
        method:      "image_ocr",
        confidence,
        pageTexts,
        pageCount:   1,
        providerKey: this.key,
      };
    } catch (err: any) {
      console.warn(`[${this.key}] Tesseract.recognize failed:`, err?.message);
      return {
        fullText:    "",
        mainText:    "",
        method:      "ocr_error",
        confidence:  0,
        pageTexts:   [],
        pageCount:   0,
        providerKey: this.key,
      };
    }
  }
}

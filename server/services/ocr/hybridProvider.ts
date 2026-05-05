/**
 * ocr/hybridProvider.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Composite ExtractionProvider that mirrors the original pipeline:
 *
 *   PDF  →  native text (NativePdfProvider)
 *               ↓ if < NATIVE_TEXT_THRESHOLD chars
 *           OCR fallback (TesseractProvider)
 *   Image → OCR directly (TesseractProvider)
 *
 * The composite itself is also an ExtractionProvider, so it can be swapped
 * out for a fully-cloud pipeline (e.g. DocumentAI) without changing callers.
 */

import type { ExtractionProvider, ExtractionResult, PageResult } from "./types";
import { NativePdfProvider }  from "./nativePdfProvider";
import { TesseractProvider }  from "./tesseractProvider";

const NATIVE_TEXT_THRESHOLD = 150;   // minimum useful chars from native PDF

export class HybridProvider implements ExtractionProvider {
  readonly key         = "hybrid_pdf_ocr";
  readonly displayName = "Hybrid (pdf-parse + Tesseract.js fallback)";

  private readonly nativePdf  = new NativePdfProvider();
  private readonly tesseract  = new TesseractProvider();

  async extractText(filePath: string, mimeType: string): Promise<ExtractionResult> {
    const isPdf =
      mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      return this.extractPdf(filePath, mimeType);
    }

    return this.extractImage(filePath, mimeType);
  }

  // ── PDF path: native first, OCR fallback ───────────────────────────────────

  private async extractPdf(
    filePath: string,
    mimeType: string,
  ): Promise<ExtractionResult> {
    const native     = await this.nativePdf.extractText(filePath, mimeType);
    const cleanText  = native.mainText;

    if (cleanText.length >= NATIVE_TEXT_THRESHOLD) {
      return { ...native, providerKey: this.key };
    }

    console.log(
      `[HybridProvider] PDF native text only ${cleanText.length} chars — running OCR fallback`,
    );

    const ocr = await this.tesseract.extractText(filePath, mimeType);
    const bestText = ocr.fullText.trim().length > cleanText.length
      ? ocr.fullText
      : native.fullText;

    const ocrPages: PageResult[] = ocr.fullText.trim().length > 0
      ? ocr.pageTexts
      : [];

    const pages = [
      ...native.pageTexts.filter(p => p.text.trim().length > 10),
      ...ocrPages,
    ];

    const method = ocrPages.length > 0 ? "hybrid_ocr" : "native_pdf_low_confidence";
    const conf   = ocrPages.length > 0 ? ocr.confidence : 0.25;

    return {
      fullText:    bestText,
      mainText:    bestText.replace(/\s{3,}/g, "\n\n").trim(),
      method,
      confidence:  conf,
      pageTexts:   pages.length > 0
        ? pages
        : [{ page: 1, text: bestText, method, confidence: conf }],
      pageCount:   Math.max(native.pageCount, 1),
      providerKey: this.key,
    };
  }

  // ── Image path: OCR directly ───────────────────────────────────────────────

  private async extractImage(
    filePath: string,
    mimeType: string,
  ): Promise<ExtractionResult> {
    const result = await this.tesseract.extractText(filePath, mimeType);
    return { ...result, providerKey: this.key };
  }
}

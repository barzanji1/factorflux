/**
 * ocr/types.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Shared interfaces for the OCR provider abstraction layer.
 *
 * Adding a new provider (e.g. Google Document AI, AWS Textract):
 *   1. Create server/services/ocr/yourProvider.ts implementing ExtractionProvider
 *   2. Register it in registry.ts
 *   3. Set EXTRACTION_PROVIDER=your_key in .env / Replit Secrets
 *   Nothing else in the app needs to change.
 */

// ─── Per-page result ──────────────────────────────────────────────────────────

export interface PageResult {
  page:       number;
  text:       string;
  method:     string;
  confidence: number;
}

// ─── Unified extraction response ──────────────────────────────────────────────

export interface ExtractionResult {
  /** Raw concatenated text from all pages */
  fullText:    string;
  /** Cleaned / whitespace-normalised version used for classification */
  mainText:    string;
  /** Human-readable method tag, e.g. "native_pdf", "image_ocr", "hybrid_ocr" */
  method:      string;
  /** 0–1 confidence in the extracted text quality */
  confidence:  number;
  /** Per-page breakdown */
  pageTexts:   PageResult[];
  /** Total number of pages (or 1 for single-page images) */
  pageCount:   number;
  /** Which provider produced this result */
  providerKey: string;
}

// ─── Provider contract ────────────────────────────────────────────────────────

export interface ExtractionProvider {
  /**
   * Stable string identifier for this provider.
   * Written to docExtractionJobs.parserName for audit / traceability.
   */
  readonly key: string;

  /**
   * Human-readable name shown in logs and admin UI.
   */
  readonly displayName: string;

  /**
   * Extract text from a file at the given path.
   *
   * @param filePath  Absolute path on disk
   * @param mimeType  MIME type of the uploaded file
   * @returns         Normalised ExtractionResult — never throws; returns empty
   *                  result with confidence=0 on hard failure
   */
  extractText(filePath: string, mimeType: string): Promise<ExtractionResult>;
}

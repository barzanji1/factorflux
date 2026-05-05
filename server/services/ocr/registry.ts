/**
 * ocr/registry.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Config-based provider factory.
 *
 * Set the EXTRACTION_PROVIDER environment variable to choose a backend:
 *
 *   EXTRACTION_PROVIDER=hybrid          (default) pdf-parse + Tesseract
 *   EXTRACTION_PROVIDER=native_pdf      native pdf-parse only (no OCR)
 *   EXTRACTION_PROVIDER=tesseract_ocr   Tesseract OCR only
 *
 * To add a new provider (e.g. Google Document AI):
 *   1. Create ocr/documentAiProvider.ts implementing ExtractionProvider
 *   2. Import it here and add an entry to PROVIDERS
 *   3. Set EXTRACTION_PROVIDER=google_document_ai in secrets
 */

import type { ExtractionProvider } from "./types";
import { HybridProvider }     from "./hybridProvider";
import { NativePdfProvider }  from "./nativePdfProvider";
import { TesseractProvider }  from "./tesseractProvider";

// ─── Registry ─────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, () => ExtractionProvider> = {
  hybrid:         () => new HybridProvider(),
  native_pdf:     () => new NativePdfProvider(),
  tesseract_ocr:  () => new TesseractProvider(),
};

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: ExtractionProvider | null = null;

export function getExtractionProvider(): ExtractionProvider {
  if (_instance) return _instance;

  const key = (process.env.EXTRACTION_PROVIDER ?? "hybrid").toLowerCase();
  const factory = PROVIDERS[key];

  if (!factory) {
    console.warn(
      `[OCR Registry] Unknown EXTRACTION_PROVIDER="${key}", falling back to "hybrid". ` +
      `Available: ${Object.keys(PROVIDERS).join(", ")}`,
    );
    _instance = new HybridProvider();
  } else {
    _instance = factory();
  }

  console.log(`[OCR Registry] Provider loaded: ${_instance.displayName} (key=${_instance.key})`);
  return _instance;
}

/**
 * Reset the singleton — useful in tests or when the env var changes at
 * runtime (e.g. hot-reload in development).
 */
export function resetExtractionProvider(): void {
  _instance = null;
}

export type { ExtractionProvider, ExtractionResult, PageResult } from "./types";

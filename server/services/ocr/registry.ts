import { readFile } from "node:fs/promises";
import type { ExtractionProvider, ExtractionResult, OcrProvider } from "./types";
import { TextractProvider } from "./textractProvider";
import { TesseractProvider } from "./tesseractProvider";
import { NativePdfProvider } from "./nativePdfProvider";
import { HybridProvider } from "./hybridProvider";

const PROVIDERS: Record<string, () => OcrProvider> = {
  textract: () => new TextractProvider(),
};

export class OcrExtractionAdapter implements ExtractionProvider {
  readonly key: string;
  readonly displayName: string;
  constructor(private readonly primary: OcrProvider, private readonly fallback: OcrProvider = new TesseractProvider()) {
    this.key = primary.key;
    this.displayName = `${primary.key} OCR`;
  }
  async extractText(filePath: string, mimeType: string, docType = "other"): Promise<ExtractionResult> {
    const buffer = await readFile(filePath);
    // Provider exceptions must fail the job. Never hide access, transport, or
    // configuration errors behind an apparently completed fallback result.
    let result = await this.primary.extract(buffer, mimeType, docType);
    let usedProvider = this.primary.key;
    // Tesseract is only a fallback for a successful but text-empty cloud result.
    if (!result.text.trim()) {
      result = await this.fallback.extract(buffer, mimeType, docType);
      usedProvider = this.fallback.key;
      result.raw = { primaryProvider: this.primary.key, fallbackReason: "empty_cloud_text", fallback: result.raw };
    }
    if (!result.text.trim()) throw new Error(`${usedProvider} OCR returned no usable text`);
    const raw = result.raw as {
      pageCount?: number;
      pageResults?: { text: string; confidence: number }[];
      pages?: { text: string; confidence: number }[];
      fallback?: { pageCount?: number; pages?: { text: string; confidence: number }[] };
    };
    const pageCount = raw?.pageCount ?? (result.raw as { fallback?: { pageCount?: number } })?.fallback?.pageCount ?? 1;
    const pages = raw.pageResults ?? raw.fallback?.pages ?? raw.pages ?? [{ text: result.text, confidence: result.confidence }];
    return {
      fullText: result.text, mainText: result.text.trim(), confidence: result.confidence,
      fields: result.fields, raw: result.raw, providerKey: usedProvider,
      method: usedProvider === "tesseract_ocr" ? "image_ocr" : "textract_ocr",
      pageCount, pageTexts: pages.map((page, index) => ({
        page: index + 1, text: page.text, confidence: page.confidence, method: usedProvider,
      })),
    };
  }
}

let instance: ExtractionProvider | null = null;
export function getExtractionProvider(): ExtractionProvider {
  if (instance) return instance;
  const key = process.env.OCR_PROVIDER?.trim().toLowerCase();
  if (key) {
    const factory = PROVIDERS[key];
    if (!factory) throw new Error(`Unknown OCR_PROVIDER "${key}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
    instance = new OcrExtractionAdapter(factory());
  } else {
    // Compatibility for explicit legacy native extraction; new OCR selection
    // always takes precedence and defaults to the selected cloud provider.
    const legacy = process.env.EXTRACTION_PROVIDER;
    instance = legacy === "native_pdf" ? new NativePdfProvider()
      : legacy === "hybrid" ? new HybridProvider()
      : new OcrExtractionAdapter(new TextractProvider());
  }
  console.log(`[OCR Registry] Provider loaded: ${instance.displayName} (key=${instance.key})`);
  return instance;
}
export type { ExtractionProvider, ExtractionResult, PageResult, OcrProvider, OcrResult, OcrFields } from "./types";

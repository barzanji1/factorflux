import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OcrProvider, OcrResult, ExtractionProvider, ExtractionResult } from "./types";
import { fieldsFromText } from "./ocrFields";
import { renderPages } from "./renderPages";

// Fallback only. createWorker is a real named export in Tesseract 7;
// recognize is only exposed on the CommonJS default export.
export class TesseractProvider implements OcrProvider, ExtractionProvider {
  readonly key = "tesseract_ocr";
  readonly displayName = "Tesseract.js fallback";

  async extract(buffer: Buffer, mimeType: string, _docType: string): Promise<OcrResult> {
    const pages = await renderPages(buffer, mimeType);
    const { createWorker } = await import("tesseract.js");
    const cachePath = path.join(tmpdir(), "truckingpros-ocr");
    await mkdir(cachePath, { recursive: true });
    const worker = await createWorker("eng", undefined, {
      cachePath,
      logger: () => {},
      errorHandler: () => {}, // recognize's promise still rejects; no uncaught worker throw.
    });
    const results: { text: string; confidence: number }[] = [];
    try {
      for (const page of pages) {
        const result = await worker.recognize(page);
        results.push({ text: result.data.text, confidence: result.data.confidence / 100 });
      }
    } finally {
      await worker.terminate();
    }
    const text = results.map(result => result.text).join("\n\n");
    if (!text.trim()) throw new Error("Tesseract OCR returned no document text");
    return {
      text, confidence: results.reduce((sum, result) => sum + result.confidence, 0) / results.length,
      fields: fieldsFromText(text),
      raw: { provider: this.key, pageCount: pages.length, pages: results },
    };
  }

  async extractText(filePath: string, mimeType: string): Promise<ExtractionResult> {
    const result = await this.extract(await readFile(filePath), mimeType, "other");
    const raw = result.raw as { pages: { text: string; confidence: number }[] };
    return {
      fullText: result.text, mainText: result.text.trim(), confidence: result.confidence,
      fields: result.fields, raw: result.raw, method: "image_ocr", providerKey: this.key,
      pageCount: raw.pages.length,
      pageTexts: raw.pages.map((page, index) => ({ ...page, page: index + 1, method: "image_ocr" })),
    };
  }
}

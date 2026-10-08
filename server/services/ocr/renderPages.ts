import { createCanvas, loadImage } from "@napi-rs/canvas";

async function compactPage(buffer: Buffer): Promise<Buffer> {
  const image = await loadImage(buffer);
  const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // PNG encoding made photographic scans exceed the 5 MB API limit.
  return canvas.encode("jpeg", 90);
}

// Rasterization only: no native text parsing is substituted for OCR.
export async function renderPages(buffer: Buffer, mimeType: string): Promise<Buffer[]> {
  if (mimeType !== "application/pdf") {
    if (!["image/png", "image/jpeg", "image/tiff", "image/webp"].includes(mimeType)) {
      throw new Error(`Unsupported OCR MIME type: ${mimeType}`);
    }
    return [await compactPage(buffer)];
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getScreenshot({
      desiredWidth: 2000, imageDataUrl: false, imageBuffer: true,
    });
    if (!result.pages.length) throw new Error("PDF has no renderable pages");
    return Promise.all(result.pages.map(page => compactPage(Buffer.from(page.data))));
  } finally {
    await parser.destroy();
  }
}

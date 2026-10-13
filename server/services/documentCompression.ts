import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);
export const DOCUMENT_UPLOAD_LIMIT = 135 * 1024 * 1024;
export function documentCompressionThreshold() {
  const mb = Number(process.env.DOC_MAX_SIZE_MB ?? 5);
  if (!Number.isFinite(mb) || mb <= 0) throw new Error("DOC_MAX_SIZE_MB must be a positive number");
  return Math.floor(mb * 1024 * 1024);
}

export type CompressedDocument = {
  buffer: Buffer; mimeType: string; originalSize: number; compressedSize: number;
};
export async function choosePdfCompression(threshold: number, run: (setting: "ebook" | "screen") => Promise<Buffer>) {
  const ebook = await run("ebook");
  if (ebook.length <= threshold) return ebook;
  const screen = await run("screen");
  return screen.length <= threshold ? screen : ebook;
}
export async function compressDocument(buffer: Buffer, mimeType: string, threshold = documentCompressionThreshold()): Promise<CompressedDocument> {
  const originalSize = buffer.length;
  const result = (output: Buffer, type = mimeType): CompressedDocument =>
    ({ buffer: output, mimeType: type, originalSize, compressedSize: output.length });
  if (originalSize <= threshold || (!mimeType.startsWith("image/") && mimeType !== "application/pdf")) {
    return result(buffer);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "document-compression-"));
  try {
    const input = path.join(dir, "input");
    await writeFile(input, buffer);
    if (mimeType === "application/pdf") {
      if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid PDF document");
      const run = async (setting: string) => {
        const output = path.join(dir, `${setting}.pdf`);
        await exec("gs", ["-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4", `-dPDFSETTINGS=/${setting}`, `-sOutputFile=${output}`, input],
        { timeout: 120_000, maxBuffer: 1024 * 1024 });
        return readFile(output);
      };
      return result(await choosePdfCompression(threshold, run));
    }
    let source = buffer;
    // The bundled Sharp/libvips handles TIFF/JPEG/PNG, but not HEIC on all builds.
    if (["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"].includes(mimeType)) {
      const converted = path.join(dir, "decoded.png");
      await exec("heif-convert", [input, converted], { timeout: 120_000, maxBuffer: 1024 * 1024 });
      source = await readFile(converted);
    }
    const metadata = await sharp(source, { pages: -1 }).metadata();
    let width = metadata.width!, height = metadata.height!;
    if (!width || !height) throw new Error("Image dimensions unavailable");
    while (true) {
      for (const quality of [85, 75, 65, 55, 45, 35, 30]) {
        const jpeg = await sharp(source, { pages: -1 }).rotate()
          .resize({ width, height, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer();
        if (jpeg.length <= threshold) return result(jpeg, "image/jpeg");
      }
      if (width === 1 && height === 1) throw new Error("Image cannot fit the configured document threshold");
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type UploadFile = Pick<Express.Multer.File, "buffer" | "mimetype" | "size" | "originalname"> & {
  originalSize?: number; compressedSize?: number;
};
export function documentSizeMetadata(file: UploadFile) {
  return { originalSize: file.originalSize ?? file.size, compressedSize: file.compressedSize ?? file.size };
}
export async function prepareDocument(file: UploadFile) {
  const output = await compressDocument(file.buffer, file.mimetype.toLowerCase());
  file.buffer = output.buffer;
  file.size = output.compressedSize;
  file.originalSize = output.originalSize;
  file.compressedSize = output.compressedSize;
  if (output.mimeType !== file.mimetype.toLowerCase()) {
    file.originalname = `${path.parse(file.originalname).name}.jpg`;
  }
  file.mimetype = output.mimeType;
}

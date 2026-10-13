import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { choosePdfCompression, compressDocument, prepareDocument, documentSizeMetadata } from "./documentCompression";

const MB = 1024 * 1024;
const noisy = async (size: number) => sharp(randomBytes(size * size * 3),
  { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
test("below and exactly at threshold are unchanged; oversized office files are unchanged", async () => {
  for (const size of [5 * MB - 1, 5 * MB]) {
    const input = Buffer.alloc(size);
    assert.equal((await compressDocument(input, "application/pdf")).buffer, input);
    assert.equal((await compressDocument(input, "image/png")).buffer, input);
  }
  for (const type of ["application/msword", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) {
    const input = Buffer.alloc(6 * MB);
    assert.equal((await compressDocument(input, type)).buffer, input);
  }
});
test("large PNG becomes JPEG with matching file size, MIME and extension", async () => {
  const input = await noisy(1600);
  assert(input.length > 5 * MB);
  const file = { buffer: input, size: input.length, mimetype: "image/png", originalname: "carrier.png" };
  await prepareDocument(file);
  assert(file.size <= 5 * MB);
  assert.equal(file.size, file.buffer.length);
  assert.equal(file.mimetype, "image/jpeg");
  assert.equal(file.originalname, "carrier.jpg");
  assert.deepEqual(documentSizeMetadata(file), { originalSize: input.length, compressedSize: file.size });
  assert.equal((await sharp(file.buffer).metadata()).format, "jpeg");
  console.log(`PNG: ${input.length} → ${file.size} bytes`);
});
test("oversized JPEG and TIFF are decoded and reduced", async () => {
  const input = await noisy(1600);
  for (const [type, encoded] of [
    ["image/jpeg", await sharp(input).jpeg({ quality: 100 }).toBuffer()],
    ["image/tiff", await sharp(input).tiff({ compression: "none" }).toBuffer()],
  ] as const) {
    const output = await compressDocument(encoded, type, MB);
    assert(output.buffer.length <= MB);
    assert.equal(output.mimeType, "image/jpeg");
  }
});
test("quality exhaustion halves dimensions and retries against configured threshold", async () => {
  const input = await noisy(1000);
  const output = await compressDocument(input, "image/png", 20 * 1024);
  const dimensions = await sharp(output.buffer).metadata();
  assert(output.buffer.length <= 20 * 1024);
  assert(dimensions.width! < 1000 && dimensions.height! < 1000);
});
test("HEIC conversion uses installed libheif decoder", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "compression-heic-test-"));
  try {
    const source = path.join(dir, "source.png"), heic = path.join(dir, "source.heic");
    await writeFile(source, await noisy(128));
    await promisify(execFile)("heif-enc", ["-q", "90", "-o", heic, source], { timeout: 120_000, maxBuffer: 4 * MB });
    const input = await readFile(heic);
    const result = await compressDocument(input, "image/heic", 1024);
    assert.equal(result.mimeType, "image/jpeg");
    assert(result.buffer.length <= 1024);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("PDF selection: ebook first; screen only if needed; retain ebook if both exceed", async () => {
  for (const [ebookSize, screenSize, expected, settings] of [
    [3, 2, 3, ["ebook"]], [8, 4, 4, ["ebook", "screen"]], [8, 7, 8, ["ebook", "screen"]],
  ] as const) {
    const calls: string[] = [];
    const result = await choosePdfCompression(5, async setting => {
      calls.push(setting); return Buffer.alloc(setting === "ebook" ? ebookSize : screenSize);
    });
    assert.equal(result.length, expected);
    assert.deepEqual(calls, settings);
  }
});
test("real Ghostscript PDF compression preserves both pages and readable text", async () => {
  const doc = new PDFDocument({ compress: false });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
  });
  doc.text("Carrier invoice page one").image(await noisy(1600), 30, 100, { width: 500 });
  doc.addPage().text("Proof of delivery page two"); doc.end();
  const input = await completed;
  assert(input.length > 5 * MB);
  const output = await compressDocument(input, "application/pdf");
  assert(output.compressedSize < output.originalSize);
  const parser = new PDFParse({ data: output.buffer });
  try {
    const parsed = await parser.getText();
    assert.equal(parsed.total, 2);
    assert(parsed.text.includes("Carrier invoice page one"));
    assert(parsed.text.includes("Proof of delivery page two"));
    console.log(`PDF: ${input.length} → ${output.compressedSize} bytes; pages=${parsed.total}`);
  } finally { await parser.destroy(); }
});
test("invalid oversized input fails visibly rather than storing an uncompressed success", async () => {
  await assert.rejects(compressDocument(Buffer.alloc(100), "image/png", 1));
  await assert.rejects(compressDocument(Buffer.alloc(100), "application/pdf", 1));
});
test("S3 document wrapper puts only the compressed bytes and correct MIME", async () => {
  let sent: any;
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("server/services/s3Service.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, console, process: { env: { AWS_S3_BUCKET: "isolated-fixture", AWS_REGION: "us-east-2" } },
    require: (name: string) => {
      if (name === "@aws-sdk/client-s3") return {
        S3Client: class { async send(command: any) { sent = command.input; } },
        PutObjectCommand: class { constructor(public input: any) {} },
      };
      if (name === "@aws-sdk/s3-request-presigner") return {};
      if (name === "./documentCompression") return { prepareDocument };
      throw new Error(`Unexpected fixture import: ${name}`);
    },
  });
  const buffer = await noisy(1600);
  const file = { buffer, size: buffer.length, mimetype: "image/png", originalname: "bill.png" };
  assert.equal(await exports.uploadDocumentToS3(file, "documents/fixture"), "documents/fixture");
  assert.equal(sent.ContentType, "image/jpeg");
  assert.equal(sent.Body, file.buffer);
  assert.notEqual(sent.Body, buffer);
  assert(sent.Body.length <= 5 * MB);
  assert.equal(sent.Key, "documents/fixture");
});

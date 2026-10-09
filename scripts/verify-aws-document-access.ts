// Uses the application's S3 upload/signing/deletion wrappers with the current
// credentials. Prints neither credential values nor signed URLs.
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { uploadToS3, getSignedDownloadUrl, deleteFromS3Strict } from "../server/services/s3Service";
import { db, pool } from "../server/db";
import { documents } from "../shared/schema";
import { isNotNull, asc } from "drizzle-orm";

async function verifyExistingDownload() {
  try {
    const [document] = await db.select({ key: documents.s3Key })
      .from(documents).where(isNotNull(documents.s3Key)).orderBy(asc(documents.size)).limit(1);
    if (!document?.key) {
      console.log(JSON.stringify({ existingSignedDownloadVerified: false,
        reason: "No existing S3-backed document is available; cannot verify download independently of the blocked upload" }));
      return;
    }
    const bucket = "factorflux-documents-tpf";
    const resource = `arn:aws:s3:::${bucket}/${document.key}`;
    try {
      const url = await getSignedDownloadUrl(document.key, "aws-existing-document-check.pdf", 300);
      assert.ok(new URL(url).hostname.startsWith(`${bucket}.s3.`),
        "Configured S3 destination is not the expected factorflux-documents-tpf bucket");
      const response = await fetch(url);
      if (!response.ok) {
        const xml = await response.text();
        console.log(JSON.stringify({ existingSignedDownloadVerified: false, status: response.status,
          action: "s3:GetObject", resource,
          code: xml.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] ?? `HTTP${response.status}`,
          message: xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? "Download failed" }));
        process.exitCode = 1;
        return;
      }
      const bytes = (await response.arrayBuffer()).byteLength;
      assert.ok(bytes > 0, "Signed download returned an empty object");
      assert.match(response.headers.get("content-disposition") ?? "", /attachment;.*aws-existing-document-check\.pdf/);
      console.log(JSON.stringify({ existingSignedDownloadVerified: true, status: response.status,
        resource, downloadedBytes: bytes, attachmentDispositionVerified: true }));
    } catch (error) {
      console.log(JSON.stringify({ existingSignedDownloadVerified: false, action: "s3:GetObject",
        resource, code: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  } finally { await pool.end(); }
}

async function main() {
  const bucket = "factorflux-documents-tpf";
  const key = `documents/credential-check-${randomUUID()}.pdf`;
  const resource = `arn:aws:s3:::${bucket}/${key}`;
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  const pdf = new Promise<Buffer>((resolve, reject) => {
    document.on("data", chunk => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.text("FactorFlux AWS credentials verification");
  document.text("Non-business test document. This object is removed after verification.");
  document.end();
  const original = await pdf;
  const failures: { action: string; resource: string; code: string; message: string }[] = [];
  let uploaded = false, downloaded = false, cleaned = false;
  let action = "s3:GetObject";
  try {
    const url = await getSignedDownloadUrl(key, "aws-credentials-check.pdf", 300);
    // Validate the expected bucket before making an upload. Never print the URL.
    const host = new URL(url).hostname;
    assert.ok(host.startsWith(`${bucket}.s3.`) || host.startsWith(`${bucket}.s3-`),
      "Configured S3 destination is not the expected factorflux-documents-tpf bucket");
    action = "s3:PutObject";
    await uploadToS3(original, key, "application/pdf");
    uploaded = true;
    action = "s3:GetObject";
    const response = await fetch(url);
    if (!response.ok) {
      const xml = await response.text();
      const error = new Error(xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? `HTTP ${response.status}`);
      error.name = xml.match(/<Code>([\s\S]*?)<\/Code>/)?.[1] ?? `HTTP${response.status}`;
      throw error;
    }
    const received = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(received).digest("hex"),
      createHash("sha256").update(original).digest("hex"), "Downloaded PDF differs from uploaded PDF");
    assert.match(response.headers.get("content-disposition") ?? "", /attachment;.*aws-credentials-check\.pdf/);
    downloaded = true;
    console.log(JSON.stringify({
      bucket, key, uploaded: true, signedDownloadStatus: response.status,
      uploadedBytes: original.length, downloadedBytes: received.length,
      sha256Matches: true, contentType: response.headers.get("content-type"),
      attachmentDispositionVerified: true,
    }));
  } catch (error) {
    failures.push({ action, resource, code: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (uploaded) {
      try { await deleteFromS3Strict(key); cleaned = true; }
      catch (error) {
        failures.push({ action: "s3:DeleteObject", resource,
          code: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  console.log(JSON.stringify({ bucket, resource, uploaded, signedDownloadVerified: downloaded,
    testObjectRemoved: cleaned, failures }));
  if (failures.length || !uploaded || !downloaded) process.exitCode = 1;
  return downloaded;
}
const existingOnly = process.argv.includes("--existing-only");
(existingOnly ? verifyExistingDownload() : main().then(verified =>
  verified ? pool.end() : verifyExistingDownload())).catch(async error => {
  console.error(error instanceof Error ? error.message : String(error));
  await pool.end().catch(() => {});
  process.exitCode = 1;
});

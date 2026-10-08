// Real queued extraction, not a mocked provider. Run from the project root:
// npx tsx scripts/verify-pilot-ocr.ts
// Isolated document/job rows are deleted after reporting; input files stay intact.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { documents, users, docExtractionJobs, docExtractionResults, docFieldCandidates } from "../shared/schema";
import { getExtractionProvider } from "../server/services/ocr/registry";

async function worker() {
  const jobId = Number(process.argv[3]), documentId = Number(process.argv[4]), filePath = process.argv[5];
  let fatal = false;
  const fail = async (error: unknown) => {
    if (fatal) return;
    fatal = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pilot OCR worker failure]", message);
    await db.update(docExtractionJobs).set({
      status: "failed", errorMessage: message, completedAt: new Date(),
    }).where(eq(docExtractionJobs.id, jobId)).catch(() => {});
    await db.update(documents).set({ status: "failed" }).where(eq(documents.id, documentId)).catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  };
  // Tesseract worker errors can otherwise terminate the process outside the
  // queue's promise catch. This handler is restricted to this verification CLI.
  process.once("uncaughtException", fail);
  process.once("unhandledRejection", fail);
  const provider = getExtractionProvider();
  if (provider.key === "native_pdf") {
    await fail(new Error("Configured provider is native_pdf; no OCR provider is configured"));
    return;
  }
  const { jobQueue } = await import("../server/services/jobQueue");
  jobQueue.enqueue({ jobId, documentId, filePath, mimeType: "application/pdf" });
  const deadline = Date.now() + 120_000;
  while (!fatal && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 400));
    const [job] = await db.select().from(docExtractionJobs).where(eq(docExtractionJobs.id, jobId));
    if (job?.status === "completed" || job?.status === "failed") {
      await pool.end();
      process.exit(job.status === "completed" ? 0 : 1);
    }
  }
  await fail(new Error("Queued OCR did not finish within 120 seconds"));
}

async function main() {
  const provider = getExtractionProvider();
  const [author] = await db.select({ id: users.id }).from(users).limit(1);
  if (!author) throw new Error("An existing user is required for isolated verification documents");
  const reports: unknown[] = [];
  let anyOcrFailure = false;
  for (const input of [
    "uploads/a7a4b423fdd5abff1900a2f918dfb631.pdf",
    "uploads/28cf8e0ebc4f1f00e6ac94d516fc6754.pdf",
  ]) {
    const filePath = path.resolve(input);
    const [doc] = await db.insert(documents).values({
      filename: path.basename(input), originalName: `Pilot OCR verification: ${path.basename(input)}`,
      mimeType: "application/pdf", size: statSync(filePath).size, documentType: "other",
      uploadedBy: author.id, clientId: null, loadId: null, invoiceId: null, companyId: null,
    }).returning({ id: documents.id });
    try {
      const [job] = await db.insert(docExtractionJobs).values({
        documentId: doc.id, jobType: "ocr", status: "queued",
      }).returning({ id: docExtractionJobs.id });
      let log = "";
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url),
          "--worker", String(job.id), String(doc.id), filePath], { stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => child.kill("SIGKILL"), 150_000);
        child.stdout.on("data", data => { log += String(data); });
        child.stderr.on("data", data => { log += String(data); });
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("close", code => { clearTimeout(timer); resolve(code); });
      });
      const [finished] = await db.select().from(docExtractionJobs).where(eq(docExtractionJobs.id, job.id));
      const [result] = await db.select().from(docExtractionResults).where(eq(docExtractionResults.jobId, job.id));
      const fields = await db.select({
        name: docFieldCandidates.fieldName, value: docFieldCandidates.normalizedValue,
      }).from(docFieldCandidates).where(eq(docFieldCandidates.documentId, doc.id));
      // A "completed" queue row is NOT evidence of OCR success. Explicitly
      // reject native-only, low-confidence fallback, and empty OCR results.
      const genuineOcr = exitCode === 0 && finished?.status === "completed" &&
        ["hybrid_ocr", "image_ocr"].includes(result?.extractionMethod ?? "") &&
        Boolean(result?.fullText?.trim());
      anyOcrFailure ||= !genuineOcr;
      const field = (name: string) => genuineOcr ? fields.find(item => item.name === name)?.value ?? null : null;
      const errors = log.split("\n").filter(line =>
        /PDF reading|pixRead|not supported|Tesseract.*failed|worker failure|Error:|native text only/.test(line));
      const report = {
        file: input, queued: true, attemptCount: finished?.attemptCount,
        configuredProvider: provider.key, jobProvider: finished?.parserName,
        ocrProviderAttempted: log.includes("[tesseract_ocr]") || provider.key === "tesseract_ocr"
          ? "tesseract_ocr" : genuineOcr && provider.key === "hybrid_pdf_ocr" ? "tesseract_ocr" : null,
        ocrStatus: genuineOcr ? "success" : "failed", queueStatus: finished?.status,
        extractionMethod: result?.extractionMethod ?? null,
        textLength: genuineOcr ? result!.fullText!.length : null,
        confidence: genuineOcr ? Number(result!.confidenceScore) : null,
        detectedInvoiceNumber: field("invoice_number"), detectedLoadNumber: field("load_number"),
        detectedAmount: field("amount"), detectedBrokerName: field("broker_name"),
        error: genuineOcr ? null : finished?.errorMessage || errors.join("; ") || "No successful OCR result returned",
        providerDiagnostics: errors,
      };
      reports.push(report);
      console.log(JSON.stringify(report));
    } finally {
      // Only this newly created document and its cascading audit children.
      // Never delete existing documents or files.
      await db.delete(documents).where(eq(documents.id, doc.id));
    }
  }
  console.log(JSON.stringify({ verificationComplete: true, allOcrSucceeded: !anyOcrFailure, isolatedRecordsCleaned: true, reports }));
  await pool.end();
  if (anyOcrFailure) process.exitCode = 1;
}

(process.argv[2] === "--worker" ? worker() : main()).catch(async error => {
  console.error(error instanceof Error ? error.message : String(error));
  await pool.end().catch(() => {});
  process.exitCode = 1;
});

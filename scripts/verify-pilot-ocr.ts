// Real queued extraction, not a mocked provider. Run from the project root:
// OCR_PROVIDER=textract npx tsx scripts/verify-pilot-ocr.ts path/to/carrier-invoice.pdf
// Isolated document/job rows are deleted after reporting; input files stay intact.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { documents, users, docExtractionJobs, docExtractionResults, docFieldCandidates } from "../shared/schema";
import { getExtractionProvider } from "../server/services/ocr/registry";
import { getIntakeSnapshot } from "../server/services/ocrIntakeSnapshot";

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
   const deadline = Date.now() + 240_000;
  while (!fatal && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 400));
    const [job] = await db.select().from(docExtractionJobs).where(eq(docExtractionJobs.id, jobId));
    if (job?.status === "completed" || job?.status === "failed") {
      await pool.end();
      process.exit(job.status === "completed" ? 0 : 1);
    }
  }
   await fail(new Error("Queued OCR did not finish within 240 seconds"));
}

async function main() {
  const fullLoad = process.argv.includes("--full-load");
  const override = process.argv.find(arg => arg.startsWith("--doc-types="))?.slice("--doc-types=".length).split(",");
  const inputs = process.argv.slice(2).filter(arg => arg !== "--full-load" && !arg.startsWith("--doc-types="));
  if (override && (override.length !== inputs.length || override.some(type => !["invoice", "rate_confirmation", "bol", "pod"].includes(type)))) {
    throw new Error("--doc-types must identify every input as invoice, rate_confirmation, bol, or pod; verification override only");
  }
  if (!inputs.length) {
    throw new Error("Provide real carrier invoice PDF paths; W-9/ID samples are not pilot invoice verification inputs.");
  }
  const provider = getExtractionProvider();
  const [author] = await db.select({ id: users.id }).from(users).limit(1);
  if (!author) throw new Error("An existing user is required for isolated verification documents");
  const reports: unknown[] = [];
  const isolatedIds: number[] = [];
  let anyOcrFailure = false;
  try {
  for (const [index, input] of inputs.entries()) {
    const filePath = path.resolve(input);
    const [doc] = await db.insert(documents).values({
      filename: path.basename(input), originalName: `Pilot OCR verification: ${path.basename(input)}`,
      mimeType: "application/pdf", size: statSync(filePath).size, documentType: override?.[index] ?? (fullLoad ? "other" : "invoice"),
      uploadedBy: author.id, clientId: null, loadId: null, invoiceId: null, companyId: null,
    }).returning({ id: documents.id });
    isolatedIds.push(doc.id);
    try {
      const [job] = await db.insert(docExtractionJobs).values({
        documentId: doc.id, jobType: "ocr", status: "queued",
      }).returning({ id: docExtractionJobs.id });
      let log = "";
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url),
          "--worker", String(job.id), String(doc.id), filePath], { stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => child.kill("SIGKILL"), 270_000);
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
        ["textract_ocr", "hybrid_ocr", "image_ocr"].includes(result?.extractionMethod ?? "") &&
        Boolean(result?.fullText?.trim());
      anyOcrFailure ||= !genuineOcr;
      const field = (name: string) => genuineOcr ? fields.find(item => item.name === name)?.value ?? null : null;
      const errors = log.split("\n").filter(line =>
        /PDF reading|pixRead|not supported|Tesseract.*failed|worker failure|Error:|native text only/.test(line));
      const report = {
        file: input, queued: true, attemptCount: finished?.attemptCount,
        configuredProvider: provider.key, jobProvider: finished?.parserName,
        ocrProviderAttempted: log.includes("[tesseract_ocr]") || provider.key === "tesseract_ocr"
          ? "tesseract_ocr" : provider.key === "textract" ? "textract"
          : genuineOcr && provider.key === "hybrid_pdf_ocr" ? "tesseract_ocr" : null,
        providerUsed: genuineOcr ? (result?.rawPayloadJson as { providerKey?: string })?.providerKey ?? provider.key : null,
        ocrStatus: genuineOcr ? "success" : "failed", queueStatus: finished?.status,
        extractionMethod: result?.extractionMethod ?? null,
        textLength: genuineOcr ? result!.fullText!.length : null,
        confidence: genuineOcr ? Number(result!.confidenceScore) : null,
        pageCount: genuineOcr ? result!.pageCount : null,
        detectedInvoiceNumber: field("invoice_number"), detectedLoadNumber: field("load_number"),
        detectedAmount: field("amount"), detectedBrokerName: field("broker_name"),
        detectedServiceDate: field("service_date"), detectedBolNumber: field("bol_number"),
        loadNumberSourceLabel: field("load_number_label"),
        detectedInvoiceDate: field("invoice_date"),
        matchedBrokerId: field("broker_id"), brokerMatchConfidence: field("broker_match_confidence"),
        matchedBrokerName: field("broker_matched_name"),
        structuredFields: (result?.rawPayloadJson as any)?.fields ?? null,
        classification: (result?.rawPayloadJson as any)?.providerRaw?.classification ?? null,
        operation: (result?.rawPayloadJson as any)?.providerRaw?.operation ?? null,
        queryAnswers: ((result?.rawPayloadJson as any)?.providerRaw?.pages ?? []).map((page: any) => page.answers ?? null),
        classificationMode: override ? "explicit_verification_override" : fullLoad ? "automatic_claude_haiku" : "explicit_invoice",
        error: genuineOcr ? null : finished?.errorMessage || errors.join("; ") || "No successful OCR result returned",
        providerDiagnostics: errors,
      };
      reports.push(report);
      console.log(JSON.stringify(report));
    } finally {
      // Only this newly created document and its cascading audit children.
      // Never delete existing documents or files.
      if (!fullLoad) await db.delete(documents).where(eq(documents.id, doc.id));
    }
  }
  if (fullLoad) {
    const snapshot = await getIntakeSnapshot(isolatedIds, { id: author.id, role: "admin" });
    if (snapshot.missingTypes.length) anyOcrFailure = true;
    console.log(JSON.stringify({ fullLoad: true, status: snapshot.status,
      classificationMode: override ? "explicit_verification_override" : "automatic_claude_haiku",
      missingTypes: snapshot.missingTypes, tolerance: snapshot.tolerance,
      fields: snapshot.fields, sources: snapshot.sources, crossChecks: snapshot.alerts,
      brokerMatch: snapshot.brokerMatch, documents: snapshot.documents }));
  }
  } finally {
    for (const id of isolatedIds) await db.delete(documents).where(eq(documents.id, id));
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

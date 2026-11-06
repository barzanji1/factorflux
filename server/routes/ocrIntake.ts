import type { Express, RequestHandler } from "express";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { eq, desc, asc, and, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { documents, docExtractionJobs, docFieldCandidates } from "../../shared/schema";
import { uploadDocumentToS3 } from "../services/s3Service";
import { documentSizeMetadata } from "../services/documentCompression";
import { jobQueue } from "../services/jobQueue";
import { findOcrBrokerMatch } from "../services/ocrBrokerMatching";
import { getIntakeSnapshot, parseIntakeIds } from "../services/ocrIntakeSnapshot";
import { IntakeError } from "../services/ocrIntakeMapping";
import { newOcrTrace, withOcrTrace, startOcrStage, logOcrTiming } from "../services/ocrPipelineTiming";
import { presetDocumentClassification } from "../services/documentTypeHints";

export function registerOcrIntakeRoutes(
  app: Express, auth: RequestHandler, upload: RequestHandler,
  compensate: (key: string, reason: string) => Promise<boolean>,
) {
  app.post("/api/invoices/ocr-intake", auth, (req, res, next) => {
    const trace = newOcrTrace();
    withOcrTrace(trace, () => {
      const finish = startOcrStage("File Receive/Validation");
      res.locals.finishOcrReceive = finish;
      res.once("finish", () => {
        if (res.statusCode >= 400) {
          finish("failed");
          logOcrTiming("Total End-to-End", trace.startedAt, "upload_failed");
        }
      });
      next();
    });
  }, upload, async (req: any, res) => {
    const staged: { key: string; tmpPath: string }[] = [];
    let committed = false;
    try {
      const files = (Array.isArray(req.files) ? req.files : req.file ? [req.file] : []) as Express.Multer.File[];
      if (!files.length || files.length > 20 || files.some(file => file.mimetype !== "application/pdf" ||
        !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))) {
        return res.status(400).json({ message: "Upload up to twenty valid PDF documents." });
      }
      const prepared: { file: Express.Multer.File; filename: string; tmpPath: string; key: string; sourceSha256: string }[] = [];
      res.locals.finishOcrReceive?.();
      for (const file of files) {
        const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex");
        const uuid = randomUUID(), filename = `invoice-ocr-${uuid}.pdf`, tmpPath = `/tmp/${filename}`;
        const key = `documents/${uuid}`;
        staged.push({ key, tmpPath });
        await uploadDocumentToS3(file, key);
        await writeFile(tmpPath, file.buffer);
        prepared.push({ file, filename, tmpPath, key, sourceSha256 });
      }
      const created = await db.transaction(async tx => {
        // Serialize pending-document identity checks across processes and retries.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"invoice-intake:" + req.user.id}))`);
        const batch: Array<{ doc: { id: number }; job: { id: number }; tmpPath: string;
          filename: string; needsQueue: boolean; duplicateKey: string | null; status: string }> = [];
        for (const { file, filename, tmpPath, key, sourceSha256 } of prepared) {
          const [existing] = await tx.select().from(documents).where(and(
            eq(documents.uploadedBy, req.user.id), eq(documents.sourceSha256, sourceSha256),
            isNull(documents.invoiceId), isNull(documents.loadId),
          )).orderBy(desc(documents.id)).limit(1);
          if (existing) {
            let [job] = await tx.select().from(docExtractionJobs).where(eq(docExtractionJobs.documentId, existing.id))
              .orderBy(desc(docExtractionJobs.id)).limit(1);
            const hint = presetDocumentClassification(existing);
            // Reusing a completed upload must not preserve an old "other"
            // result when the filename now has an explicit supported category.
            const needsQueue = !job || job.status === "failed" || (job.status === "completed"
              && hint?.model === "filename-pattern"
              && (existing.aiDocumentType ?? existing.candidateDocumentType ?? existing.documentType) !== hint.docType);
            if (needsQueue) [job] = await tx.insert(docExtractionJobs).values({
              documentId: existing.id, jobType: "ocr", status: "queued",
            }).returning();
            if (!batch.some(item => item.doc.id === existing.id)) batch.push({
              doc: existing, job, tmpPath, filename: existing.originalName, needsQueue,
              duplicateKey: key, status: needsQueue ? "queued" : job.status,
            });
            else batch.push({ doc: existing, job, tmpPath, filename: existing.originalName, needsQueue: false, duplicateKey: key, status: job.status });
            continue;
          }
          const [doc] = await tx.insert(documents).values({
          filename, originalName: String(file.originalname).replace(/[\\/]/g, "_").slice(0, 255),
          mimeType: "application/pdf", size: file.buffer.length, s3Key: key,
          ...documentSizeMetadata(file),
          sourceSha256,
          documentType: "other", sourceChannel: "manual", status: "processing",
          uploadedBy: req.user.id, clientId: null, loadId: null, invoiceId: null, companyId: null,
        }).returning({ id: documents.id });
        const [job] = await tx.insert(docExtractionJobs).values({
          documentId: doc.id, jobType: "ocr", status: "queued",
        }).returning({ id: docExtractionJobs.id });
          batch.push({ doc, job, tmpPath, filename: file.originalname, needsQueue: true, duplicateKey: null, status: "queued" });
        }
        return batch;
      });
      committed = true;
      for (const item of created) {
        if (item.duplicateKey) await compensate(item.duplicateKey, "reused pending invoice OCR document");
        if (item.needsQueue) jobQueue.enqueue({ jobId: item.job.id, documentId: item.doc.id,
          filePath: item.tmpPath, mimeType: "application/pdf" });
        else await unlink(item.tmpPath).catch(() => {});
      }
      const unique = created.filter((item, i) => created.findIndex(other => other.doc.id === item.doc.id) === i);
      res.status(201).json({ documentId: created[0].doc.id, status: "queued",
        documents: unique.map(item => ({ documentId: item.doc.id, filename: item.filename, status: item.status })) });
    } catch (error) {
      if (!committed) {
        for (const item of staged) {
          await compensate(item.key, "invoice OCR intake compensation");
          await unlink(item.tmpPath).catch(() => {});
        }
      }
      console.error("[Invoice OCR intake]", error instanceof Error ? error.message : "Upload failed");
      res.status(500).json({ message: "Invoice OCR upload failed. Please retry." });
    }
  });

  app.get("/api/invoices/ocr-intake", auth, async (req: any, res) => {
    try {
      const raw = String(req.query.documentIds ?? "").split(",");
      if (!raw.length || raw.length > 20 || raw.some(id => !/^[1-9]\d*$/.test(id))) {
        throw new IntakeError("Provide one to twenty intake document IDs");
      }
      const snapshot = await getIntakeSnapshot(parseIntakeIds(raw.map(Number)), req.user);
      res.json(snapshot);
    } catch (error) {
      res.status(error instanceof IntakeError ? error.status : 500).json({
        message: error instanceof IntakeError ? error.message : "Failed to read intake results",
      });
    }
  });
  app.get("/api/invoices/ocr-intake/:documentId", auth, async (req: any, res) => {
    try {
      const id = Number(req.params.documentId);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid document ID" });
      const [doc] = await db.select({ uploadedBy: documents.uploadedBy }).from(documents).where(eq(documents.id, id));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.uploadedBy !== req.user.id && !["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "You may only extract your own intake documents" });
      }
      const [job] = await db.select().from(docExtractionJobs).where(eq(docExtractionJobs.documentId, id))
        .orderBy(desc(docExtractionJobs.id)).limit(1);
      if (!job) return res.status(404).json({ message: "Extraction job not found" });
      const fields: Record<string, string> = {};
      if (job.status === "completed") {
        const rows = await db.select().from(docFieldCandidates).where(eq(docFieldCandidates.documentId, id))
          .orderBy(asc(docFieldCandidates.id));
        for (const row of rows) if (row.normalizedValue != null) fields[row.fieldName] = row.normalizedValue;
      }
      const match = await findOcrBrokerMatch(fields.broker_name ?? null);
      // Re-check the current directory; stale or ambiguous IDs are never sent
      // to the create form as selected brokers.
      delete fields.broker_id;
      delete fields.broker_match_confidence;
      delete fields.broker_matched_name;
      if (match.brokerId && match.confidence) {
        fields.broker_id = String(match.brokerId);
        fields.broker_match_confidence = match.confidence;
      }
      res.json({ status: job.status, error: job.errorMessage, fields, brokerMatch: match });
    } catch (error) {
      console.error("[Invoice OCR status]", error instanceof Error ? error.message : "Status lookup failed");
      res.status(500).json({ message: "Failed to read invoice OCR results" });
    }
  });
}

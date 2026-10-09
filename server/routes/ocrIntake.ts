import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "../db";
import { documents, docExtractionJobs, docFieldCandidates } from "../../shared/schema";
import { uploadToS3 } from "../services/s3Service";
import { jobQueue } from "../services/jobQueue";
import { findOcrBrokerMatch } from "../services/ocrBrokerMatching";

export function registerOcrIntakeRoutes(
  app: Express, auth: RequestHandler, upload: RequestHandler,
  compensate: (key: string, reason: string) => Promise<boolean>,
) {
  app.post("/api/invoices/ocr-intake", auth, upload, async (req: any, res) => {
    let key: string | null = null, tmpPath: string | null = null, committed = false;
    try {
      const file = req.file;
      if (!file || file.mimetype !== "application/pdf" ||
        !file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
        file.buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Upload a valid PDF invoice of 5MB or less." });
      }
      const uuid = randomUUID(), filename = `invoice-ocr-${uuid}.pdf`;
      key = await uploadToS3(file.buffer, `documents/${uuid}`, "application/pdf");
      tmpPath = `/tmp/${filename}`;
      await writeFile(tmpPath, file.buffer);
      const created = await db.transaction(async tx => {
        const [doc] = await tx.insert(documents).values({
          filename, originalName: String(file.originalname).replace(/[\\/]/g, "_").slice(0, 255),
          mimeType: "application/pdf", size: file.buffer.length, s3Key: key,
          documentType: "invoice", sourceChannel: "manual", status: "processing",
          uploadedBy: req.user.id, clientId: null, loadId: null, invoiceId: null, companyId: null,
        }).returning({ id: documents.id });
        const [job] = await tx.insert(docExtractionJobs).values({
          documentId: doc.id, jobType: "ocr", status: "queued",
        }).returning({ id: docExtractionJobs.id });
        return { doc, job };
      });
      committed = true;
      jobQueue.enqueue({ jobId: created.job.id, documentId: created.doc.id,
        filePath: tmpPath, mimeType: "application/pdf" });
      res.status(201).json({ documentId: created.doc.id, status: "queued" });
    } catch (error) {
      if (!committed) {
        if (key) await compensate(key, "invoice OCR intake compensation");
        if (tmpPath) await unlink(tmpPath).catch(() => {});
      }
      console.error("[Invoice OCR intake]", error instanceof Error ? error.message : "Upload failed");
      res.status(500).json({ message: "Invoice OCR upload failed. Please retry." });
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

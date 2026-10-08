import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import { documents, docExtractionJobs } from "../../shared/schema";
import type { InvoicePreflightAlert } from "./invoicePreflight";

export function failedOcrAlerts(jobs: { status: string; originalName: string; errorMessage: string | null }[]): InvoicePreflightAlert[] {
  const failures = jobs.filter(job => job.status === "failed");
  return failures.length ? [{
    code: "DOCS_OCR_FAILED", severity: "info",
    title: "Document OCR failed",
    message: failures.map(job => `${job.originalName}: ${job.errorMessage ?? "Extraction failed"}`).join("; "),
    link: "/documents",
  }] : [];
}

export async function getInvoiceOcrAlerts(invoiceId: number, database = db): Promise<InvoicePreflightAlert[]> {
  // Only the latest attempt per document counts. A successful retry clears the
  // info alert without deleting historical failures.
  const jobs = await database.selectDistinctOn([docExtractionJobs.documentId], {
    status: docExtractionJobs.status, errorMessage: docExtractionJobs.errorMessage,
    originalName: documents.originalName,
  }).from(docExtractionJobs).innerJoin(documents, eq(documents.id, docExtractionJobs.documentId))
    .where(eq(documents.invoiceId, invoiceId))
    .orderBy(docExtractionJobs.documentId, desc(docExtractionJobs.id));
  return failedOcrAlerts(jobs);
}

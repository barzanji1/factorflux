/**
 * ExtractionJobQueue
 * ------------------
 * In-process background worker for OCR/extraction jobs.
 * Processes one job at a time (single worker model) to avoid overwhelming
 * Tesseract.js, which is CPU-intensive. Retries up to MAX_ATTEMPTS with
 * exponential back-off. All attempts are logged and tracked in the DB via
 * runExtractionJob's own status updates.
 */

import path from "path";
import { runExtractionJob } from "./documentExtraction";
import { db } from "../db";
import { docExtractionJobs, documents } from "../../shared/schema";
import { eq, inArray } from "drizzle-orm";
import { currentOcrTrace, newOcrTrace, withOcrTrace, logOcrTiming, timeOcrStage, type OcrTimingTrace } from "./ocrPipelineTiming";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS  = [3_000, 10_000, 30_000] as const;

interface PendingJob {
  jobId:      number;
  documentId: number;
  filePath:   string;
  mimeType:   string;
  attempt:    number;
  timingTrace?: OcrTimingTrace;
}

class ExtractionJobQueue {
  private readonly queue: PendingJob[] = [];
  private running = false;

  /** Enqueue a new job (always attempt = 1). */
  enqueue(job: Omit<PendingJob, "attempt">) {
    this.queue.push({ ...job, timingTrace: job.timingTrace ?? currentOcrTrace(), attempt: 1 });
    this._scheduleProcess();
  }

  /** Re-enqueue for retry — called internally after failure. */
  private _retry(job: PendingJob) {
    const delay = BACKOFF_MS[Math.min(job.attempt - 1, BACKOFF_MS.length - 1)];
    console.log(`[JobQueue] retry job ${job.jobId} in ${delay}ms (attempt ${job.attempt + 1}/${MAX_ATTEMPTS})`);
    setTimeout(() => {
      this.queue.push({ ...job, attempt: job.attempt + 1 });
      this._scheduleProcess();
    }, delay);
  }

  private _scheduleProcess() {
    if (!this.running) setImmediate(() => this._process());
  }

  private async _process() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;

    const job = this.queue.shift()!;

    try {
      // Update attempt count in DB before running
      await db
        .update(docExtractionJobs)
        .set({ attemptCount: job.attempt })
        .where(eq(docExtractionJobs.id, job.jobId));

      const trace = job.timingTrace ?? newOcrTrace();
      await withOcrTrace(trace, async () => {
        try {
          await timeOcrStage("OCR Worker", () =>
            runExtractionJob(job.documentId, job.jobId, job.filePath, job.mimeType));
        } finally {
          logOcrTiming(job.timingTrace ? "Total End-to-End" : "Total Worker (no upload trace)",
            trace.startedAt, "attempt_finished");
        }
      });
    } catch (err: any) {
      console.error(`[JobQueue] job ${job.jobId} threw (attempt ${job.attempt}):`, err?.message ?? err);
      // Mark as failed in DB (runExtractionJob normally handles this, but if it threw externally, handle it)
      try {
        await db
          .update(docExtractionJobs)
          .set({ status: "failed", errorMessage: String(err?.message ?? err), completedAt: new Date() })
          .where(eq(docExtractionJobs.id, job.jobId));
      } catch { /* ignore secondary errors */ }

      if (job.attempt < MAX_ATTEMPTS) {
        this._retry(job);
      } else {
        console.error(`[JobQueue] job ${job.jobId} exhausted all ${MAX_ATTEMPTS} attempts — giving up`);
      }
    } finally {
      this.running = false;
      // Process next job if any remain
      if (this.queue.length > 0) setImmediate(() => this._process());
    }
  }

  /** Number of jobs currently waiting. */
  get pendingCount() {
    return this.queue.length;
  }

  /**
   * Called once at server startup.
   * Finds any doc_extraction_jobs rows that are stuck in "queued" or
   * "processing" (which means the server died mid-job), resets
   * "processing" back to "queued" in the DB, then re-enqueues all of them.
   */
  async recoverStuckJobs(): Promise<void> {
    try {
      // 1. Find all stuck jobs
      const stuck = await db
        .select({
          jobId:      docExtractionJobs.id,
          documentId: docExtractionJobs.documentId,
          status:     docExtractionJobs.status,
          filename:   documents.filename,
          mimeType:   documents.mimeType,
        })
        .from(docExtractionJobs)
        .innerJoin(documents, eq(documents.id, docExtractionJobs.documentId))
        .where(inArray(docExtractionJobs.status, ["queued", "processing"]));

      if (stuck.length === 0) {
        console.log("[JobQueue] No stuck OCR jobs found at startup.");
        return;
      }

      // 2. Reset any "processing" rows back to "queued" so they're safe to retry
      const processingIds = stuck
        .filter(j => j.status === "processing")
        .map(j => j.jobId);

      if (processingIds.length > 0) {
        await db
          .update(docExtractionJobs)
          .set({ status: "queued", startedAt: null })
          .where(inArray(docExtractionJobs.id, processingIds));
      }

      // 3. Re-enqueue all stuck jobs
      for (const job of stuck) {
        const filePath = path.join("uploads", job.filename);
        this.queue.push({ jobId: job.jobId, documentId: job.documentId, filePath, mimeType: job.mimeType, attempt: 1 });
      }

      console.log(`[JobQueue] Re-enqueued ${stuck.length} stuck OCR job(s) at startup (${processingIds.length} reset from "processing").`);

      // 4. Kick off the worker
      this._scheduleProcess();
    } catch (err: any) {
      console.error("[JobQueue] Failed to recover stuck jobs at startup:", err?.message ?? err);
    }
  }
}

export const jobQueue = new ExtractionJobQueue();

/** Convenience wrapper — call this once at server startup. */
export async function recoverStuckOcrJobs(): Promise<void> {
  return jobQueue.recoverStuckJobs();
}

/**
 * ExtractionJobQueue
 * ------------------
 * In-process background worker for OCR/extraction jobs.
 * Processes one job at a time (single worker model) to avoid overwhelming
 * Tesseract.js, which is CPU-intensive. Retries up to MAX_ATTEMPTS with
 * exponential back-off. All attempts are logged and tracked in the DB via
 * runExtractionJob's own status updates.
 */

import { runExtractionJob } from "./documentExtraction";
import { db } from "../db";
import { docExtractionJobs } from "../../shared/schema";
import { eq } from "drizzle-orm";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS  = [3_000, 10_000, 30_000] as const;

interface PendingJob {
  jobId:      number;
  documentId: number;
  filePath:   string;
  mimeType:   string;
  attempt:    number;
}

class ExtractionJobQueue {
  private readonly queue: PendingJob[] = [];
  private running = false;

  /** Enqueue a new job (always attempt = 1). */
  enqueue(job: Omit<PendingJob, "attempt">) {
    this.queue.push({ ...job, attempt: 1 });
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

      await runExtractionJob(job.documentId, job.jobId, job.filePath, job.mimeType);
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
}

export const jobQueue = new ExtractionJobQueue();

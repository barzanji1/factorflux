import type { RequestHandler } from "express";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { pool } from "../db";
import { DOCUMENTS_BUCKET, operationsS3 } from "./operationsS3";

type Checks = { db: () => Promise<unknown>; s3: () => Promise<unknown> };

async function bounded(check: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Health check timed out")), 5000);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthHandler(checks: Checks = {
  db: () => pool.query("SELECT 1"),
  s3: () => operationsS3.send(new HeadBucketCommand({ Bucket: DOCUMENTS_BUCKET }), {
    abortSignal: AbortSignal.timeout(4000),
  }),
}): RequestHandler {
  // Coalesce public probes and cache briefly to avoid turning monitoring into
  // a connection/S3 request flood. Never expose credentials or provider errors.
  let cached: Promise<{ status: string; db: boolean; s3: boolean; timestamp: string }> | undefined;
  let expires = 0;
  return async (_req, res) => {
    if (!cached || Date.now() >= expires) {
      expires = Date.now() + 10_000;
      cached = Promise.all([bounded(checks.db), bounded(checks.s3)])
        .then(([db, s3]) => ({
          status: db && s3 ? "ok" : "error",
          db, s3, timestamp: new Date().toISOString(),
        }));
    }
    const result = await cached;
    res.setHeader("Cache-Control", "no-store");
    res.status(result.db && result.s3 ? 200 : 503).json(result);
  };
}

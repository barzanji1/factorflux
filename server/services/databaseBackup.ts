import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import pg from "pg";
import cron from "node-cron";
import {
  DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand,
} from "@aws-sdk/client-s3";
import { sendResendEmail } from "../resendTransport.js";
import { DOCUMENTS_BUCKET, operationsS3 } from "./operationsS3";

export const BACKUP_PREFIX = "backups/db/";
const BACKUP_PATTERN = /^backups\/db\/factorflux-\d{4}-\d{2}-\d{2}-\d{6}\.sql\.gz$/;
export class BackupInProgressError extends Error {
  constructor() { super("A database backup is already running"); }
}

export function directBackupConnectionUrl(value: string): string {
  const url = new URL(value);
  // pg_dump changes session settings with set_config(), which Neon/PgBouncer
  // transaction pooling cannot safely isolate. Never run it through -pooler.
  if (url.hostname.endsWith(".neon.tech")) {
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  }
  return url.toString();
}

function connectionUrl(): string {
  // This app uses external Neon, not the separate Replit-managed DATABASE_URL.
  const value = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!value) throw new Error("Database connection is not configured");
  return directBackupConnectionUrl(value);
}

export function backupKey(date: Date): string {
  const iso = date.toISOString();
  return `${BACKUP_PREFIX}factorflux-${iso.slice(0, 10)}-${iso.slice(11, 19).replaceAll(":", "")}.sql.gz`;
}

export function obsoleteBackups(keys: string[]): string[] {
  return [...new Set(keys.filter(key => BACKUP_PATTERN.test(key)))].sort().reverse().slice(30);
}

export async function dumpDatabase(
  destination: string,
  databaseUrl = connectionUrl(),
  binary = path.resolve("dist/tools/bin/pg_dump"),
): Promise<void> {
  const url = new URL(directBackupConnectionUrl(databaseUrl));
  const child = spawn(existsSync(binary) ? binary : "pg_dump", ["--no-password"], {
    stdio: ["ignore", "pipe", "pipe"],
    // Credentials are never passed in arguments, logs, or backup metadata.
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: url.searchParams.get("sslmode") || "require",
      PGCHANNELBINDING: url.searchParams.get("channel_binding") || "prefer",
      PGCONNECT_TIMEOUT: "10",
      // PostgreSQL's matching libpq ships alongside the generated client.
      LD_LIBRARY_PATH: [path.resolve(path.dirname(binary), "../lib"), process.env.LD_LIBRARY_PATH]
        .filter(Boolean).join(":"),
    },
  });
  let versionMismatch = false;
  child.stderr.on("data", (chunk: Buffer) => {
    if (/server version mismatch/.test(chunk.toString())) versionMismatch = true;
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("Could not start pg_dump; run npm run build:pg-dump")));
    child.once("close", code => code === 0 ? resolve() : reject(new Error(
      versionMismatch ? "pg_dump/server version mismatch; rebuild the PostgreSQL client"
        : `pg_dump failed (exit ${code ?? "signal"})`,
    )));
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30 * 60_000);
  try {
    // Await BOTH the process and pipeline; a failed dump must never be uploaded
    // as an apparently successful (but valid) empty gzip.
    await Promise.all([
      exited,
      pipeline(child.stdout, createGzip(), createWriteStream(destination, { mode: 0o600, flags: "wx" })),
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function withDatabaseLock<T>(work: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionUrl(), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '35min'");
    const result = await client.query("SELECT pg_try_advisory_xact_lock(183465, 1) AS acquired");
    if (!result.rows[0]?.acquired) throw new BackupInProgressError();
    // A transaction-scoped lock also works with Neon's pooled connections.
    const resultValue = await work();
    await client.query("COMMIT");
    return resultValue;
  } finally {
    await client.end();
  }
}

async function listBackupKeys(): Promise<string[]> {
  const keys: string[] = [];
  let continuation: string | undefined;
  do {
    const result = await operationsS3.send(new ListObjectsV2Command({
      Bucket: DOCUMENTS_BUCKET, Prefix: BACKUP_PREFIX, ContinuationToken: continuation,
    }));
    for (const item of result.Contents || []) if (item.Key) keys.push(item.Key);
    continuation = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !continuation) throw new Error("Incomplete S3 backup listing");
  } while (continuation);
  return keys;
}

interface BackupDependencies {
  now: () => Date;
  lock: <T>(work: () => Promise<T>) => Promise<T>;
  dump: (destination: string) => Promise<void>;
  upload: (key: string, file: string, bytes: number) => Promise<void>;
  list: () => Promise<string[]>;
  remove: (keys: string[]) => Promise<void>;
  alert: () => Promise<unknown>;
}

const defaults: BackupDependencies = {
  now: () => new Date(),
  lock: withDatabaseLock,
  dump: dumpDatabase,
  upload: async (Key, file, ContentLength) => {
    await operationsS3.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET, Key, Body: createReadStream(file), ContentLength,
      ContentType: "application/gzip", ServerSideEncryption: "AES256",
      // Never overwrite a backup, even if two invocations share a timestamp.
      IfNoneMatch: "*",
    }));
  },
  list: listBackupKeys,
  remove: async keys => {
    for (let offset = 0; offset < keys.length; offset += 1000) {
      const result = await operationsS3.send(new DeleteObjectsCommand({
        Bucket: DOCUMENTS_BUCKET,
        Delete: { Objects: keys.slice(offset, offset + 1000).map(Key => ({ Key })), Quiet: true },
      }));
      if (result.Errors?.length) throw new Error("S3 backup retention deletion failed");
    }
  },
  alert: () => sendResendEmail({
    to: "dosh@truckingprosfinancial.com",
    subject: "Trucking Pros Financial — database backup failed",
    text: "The FactorFlux database backup or its retention cleanup failed. Please check the server's backup logs and AWS permissions. No database credentials or contents are included in this alert.",
    emailLog: { templateName: "database_backup_failed" },
  }),
};

export async function runDatabaseBackup(overrides: Partial<BackupDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  let stage = "lock";
  try {
    return await deps.lock(async () => {
      stage = "temporary-file";
      const directory = await mkdtemp(path.join(tmpdir(), "factorflux-db-backup-"));
      const file = path.join(directory, "database.sql.gz");
      try {
        const key = backupKey(deps.now());
        stage = "pg_dump";
        await deps.dump(file);
        const { size: bytes } = await stat(file);
        if (!bytes) throw new Error("Database backup is empty");
        stage = "s3:PutObject";
        await deps.upload(key, file, bytes);
        // Retention happens only after a successful upload, and only affects
        // our exact filename pattern, never documents or unrelated S3 objects.
        stage = "s3:ListBucket";
        const obsolete = obsoleteBackups(await deps.list());
        if (obsolete.length) {
          stage = "s3:DeleteObject";
          await deps.remove(obsolete);
        }
        return { bucket: DOCUMENTS_BUCKET, key, bytes, deleted: obsolete.length };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  } catch (error) {
    if (!(error instanceof BackupInProgressError)) {
      // Do not log PostgreSQL stderr/URLs: they can contain credentials/data.
      console.error("[backup] failed", {
        stage,
        bucket: DOCUMENTS_BUCKET,
        type: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string } | null)?.code,
      });
      try { await deps.alert(); }
      catch { console.error("[backup] failure alert could not be delivered"); }
    }
    throw error;
  }
}

let scheduled = false;
export function startDatabaseBackupScheduler() {
  if (scheduled || process.env.NODE_ENV !== "production") return;
  scheduled = true;
  cron.schedule("0 3 * * *", () => {
    void runDatabaseBackup()
      .then(result => console.log("[backup] completed", result))
      .catch(error => {
        if (error instanceof BackupInProgressError) console.log("[backup] skipped: backup already running");
      });
  }, { timezone: "UTC" });
  console.log("[backup] nightly schedule enabled: 03:00 UTC");
}

import type { BackupRuntimeDiagnostics } from "./backupRuntimeDiagnostics";

// Categories and email descriptions stay allow-listed. Failure logs may also
// contain explicitly redacted stderr and credential-free runtime probes.
const REASONS = {
  CLIENT_NOT_FOUND: "pg_dump was not found. Rebuild and publish the PostgreSQL client.",
  CLIENT_RUNTIME_MISSING: "The bundled pg_dump exists, but its executable loader could not start.",
  CLIENT_EXECUTION_DENIED: "The operating system refused permission to execute pg_dump.",
  CLIENT_START_FAILED: "The pg_dump process could not start.",
  CLIENT_LIBRARY_FAILED: "pg_dump could not load a required runtime library.",
  CLIENT_VERSION_MISMATCH: "The pg_dump client is incompatible with the database server version.",
  AUTHENTICATION_FAILED: "The database rejected authentication.",
  DATABASE_PERMISSION_DENIED: "The database denied permission required for the export.",
  DATABASE_CONNECTION_FAILED: "The database connection could not be established or was interrupted.",
  TLS_FAILED: "The database TLS connection failed.",
  DATABASE_NOT_FOUND: "The configured database was not found.",
  DUMP_TIMEOUT: "pg_dump exceeded the existing 30-minute backup timeout.",
  DUMP_TERMINATED: "pg_dump was terminated by a signal.",
  DUMP_EXIT_FAILED: "pg_dump exited unsuccessfully; no recognized error category was found.",
  S3_ACCESS_DENIED: "S3 denied the backup operation shown by the failure stage.",
  S3_CREDENTIALS_INVALID: "S3 credentials are missing, invalid or expired.",
  S3_REQUEST_FAILED: "The S3 backup operation failed.",
  LOCAL_STORAGE_FULL: "Local storage was full while preparing the backup.",
  LOCAL_PERMISSION_DENIED: "Local filesystem permissions prevented the backup.",
  LOCAL_FILE_UNAVAILABLE: "A required local backup file was unavailable.",
  BACKUP_FAILED: "The backup failed without a recognized error category.",
} as const;

type FailureCode = keyof typeof REASONS;
export type BackupStage = "lock" | "temporary-file" | "pg_dump" |
  "s3:PutObject" | "s3:ListBucket" | "s3:DeleteObject";
export interface BackupFailure {
  stage: BackupStage;
  code: FailureCode;
  reason: string;
  exitCode?: number | null;
  signal?: string | null;
  runtime?: BackupRuntimeDiagnostics;
}

function safeSignal(signal?: string | null): string | null {
  if (!signal) return null;
  return ["SIGKILL", "SIGTERM", "SIGSEGV", "SIGABRT", "SIGBUS", "SIGPIPE", "SIGINT", "SIGHUP"].includes(signal)
    ? signal : "OTHER";
}

export class PgDumpFailure extends Error {
  readonly name = "PgDumpFailure";
  readonly exitCode: number | null;
  readonly signal: string | null;
  runtime?: BackupRuntimeDiagnostics;
  constructor(readonly code: FailureCode, exitCode?: number | null, signal?: string | null) {
    super(`pg_dump failed: ${REASONS[code]}`);
    this.exitCode = Number.isInteger(exitCode) ? exitCode! : null;
    this.signal = safeSignal(signal);
  }
}

function databaseFailure(text: string): FailureCode | undefined {
  if (/server version mismatch|aborting because of server version/i.test(text)) return "CLIENT_VERSION_MISMATCH";
  if (/error while loading shared libraries|symbol lookup error|(?:GLIBC(?:XX)?|OPENSSL|CXXABI)_[\d._]+.*not found/i.test(text)) return "CLIENT_LIBRARY_FAILED";
  if (/password authentication failed|no password supplied|authentication failed|no pg_hba.conf entry/i.test(text)) return "AUTHENTICATION_FAILED";
  if (/permission denied|must be (?:a |the )?(?:superuser|owner)/i.test(text)) return "DATABASE_PERMISSION_DENIED";
  if (/database .{0,256} does not exist/i.test(text)) return "DATABASE_NOT_FOUND";
  if (/SSL error|TLS error|certificate verify failed|server does not support SSL|channel binding/i.test(text)) return "TLS_FAILED";
  if (/could not translate host name|could not connect|connection (?:to server|refused|timed out)|server closed the connection|could not receive data|network is unreachable/i.test(text)) return "DATABASE_CONNECTION_FAILED";
}

export function pgDumpFailure(stderr: string, options: {
  launchCode?: string; bundled?: boolean; timedOut?: boolean;
  exitCode?: number | null; signal?: string | null;
} = {}): PgDumpFailure {
  let code: FailureCode;
  if (options.timedOut) code = "DUMP_TIMEOUT";
  else if (options.launchCode === "ENOENT") code = options.bundled ? "CLIENT_RUNTIME_MISSING" : "CLIENT_NOT_FOUND";
  else if (options.launchCode === "EACCES" || options.launchCode === "EPERM") code = "CLIENT_EXECUTION_DENIED";
  else if (options.launchCode) code = "CLIENT_START_FAILED";
  else code = databaseFailure(stderr) ?? (options.signal ? "DUMP_TERMINATED" : "DUMP_EXIT_FAILED");
  return new PgDumpFailure(code, options.exitCode, options.signal);
}

export function describeBackupFailure(stage: BackupStage, error: unknown): BackupFailure {
  if (error instanceof PgDumpFailure) {
    return { stage, code: error.code, reason: REASONS[error.code], exitCode: error.exitCode, signal: error.signal,
      ...(error.runtime ? { runtime: error.runtime } : {}) };
  }
  const value = error as { code?: string; name?: string; message?: string } | null;
  const identifiers = [value?.code, value?.name];
  let code: FailureCode = "BACKUP_FAILED";
  if (identifiers.includes("ENOSPC")) code = "LOCAL_STORAGE_FULL";
  else if (identifiers.some(id => id === "EACCES" || id === "EPERM")) code = "LOCAL_PERMISSION_DENIED";
  else if (identifiers.includes("ENOENT")) code = "LOCAL_FILE_UNAVAILABLE";
  else if (stage.startsWith("s3:")) {
    code = identifiers.some(id => id === "AccessDenied" || id === "AccessDeniedException") ? "S3_ACCESS_DENIED"
      : identifiers.some(id => ["InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "InvalidToken", "CredentialsProviderError"].includes(id ?? ""))
        ? "S3_CREDENTIALS_INVALID" : "S3_REQUEST_FAILED";
  } else if (identifiers.includes("28P01") || identifiers.includes("28000")) code = "AUTHENTICATION_FAILED";
  else if (identifiers.includes("42501")) code = "DATABASE_PERMISSION_DENIED";
  else if (identifiers.some(id => ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "08006", "08001"].includes(id ?? ""))) code = "DATABASE_CONNECTION_FAILED";
  else code = databaseFailure(typeof value?.message === "string" ? value.message : "") ?? "BACKUP_FAILED";
  return { stage, code, reason: REASONS[code] };
}

export function backupFailureEmail(failure: BackupFailure): string {
  return [
    "The Trucking Pros Financial database backup or its retention cleanup failed.",
    `Stage: ${failure.stage}`,
    `Diagnostic: ${failure.code}`,
    // Resolve the text from the allow-list, not from an exception or caller.
    `Reason: ${REASONS[failure.code]}`,
    ...(failure.exitCode != null ? [`pg_dump exit code: ${failure.exitCode}`] : []),
    ...(failure.signal ? [`pg_dump signal: ${safeSignal(failure.signal)}`] : []),
    "Check the production backup logs for this diagnostic.",
    "Database credentials, connection strings, SQL, and raw error output are intentionally omitted.",
  ].join("\n\n");
}

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { Socket } from "node:net";
import path from "node:path";

export const STDERR_LIMIT = 16_384;
export interface BackupRuntimeDiagnostics {
  stderr: string;
  stderrTruncated: boolean;
  binary: {
    exists: boolean;
    bundledExists: boolean;
    source: "bundled" | "PATH";
    version: string | null;
    versionStatus: "ok" | "unavailable" | "timeout" | "unrecognized";
  };
  databaseTcp: {
    reachable: boolean | null;
    status: "reachable" | "refused" | "dns_failed" | "timeout" | "unreachable" | "error";
  };
}

// Redact before emitting anything. On overflow, fail closed rather than expose
// credentials whose URI/key/value prefix may have been cut at the boundary.
export function redactBackupStderr(raw: string, privateValues: readonly string[], truncated = false): string {
  if (truncated || raw.length > STDERR_LIMIT) return "[REDACTED] (stderr exceeded capture limit)";
  let text = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\\\//g, "/");
  // Remove whole URI/conninfo tails, including nonstandard quoting/spaces.
  text = text.replace(/(?:jdbc:)?postgres(?:ql)?(?::\/\/|%3a%2f%2f)[^\r\n]*/gi, "[REDACTED]")
    .replace(/\b(?:password|passwd|pwd|PGPASSWORD|connection_?string|connection_?url|(?:neon_)?database_url)\b["']?\s*[:=]\s*(?:'(?:\\[\s\S]|''|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|'[\s\S]*$|"[\s\S]*$|[^\r\n]*)/gim, "[REDACTED]")
    .replace(/(?:^|[\s"'([{])(?:host|hostaddr|port|dbname|user|passfile|service|sslmode)\s*=[^\r\n]*/gim, " [REDACTED]");
  // pg_dump can append SQL or COPY data after a query/command marker. Keep the
  // actual error before that marker, but never persist the SQL/data section.
  const lines = text.split("\n");
  const sqlStart = lines.findIndex(line =>
    /(?:query was|command was|failed command was|statement:|query:|\bCONTEXT:|\bDETAIL:)|^\s*(?:pg_dump:\s*(?:detail:\s*)?)?(?:SELECT|INSERT|UPDATE|DELETE|COPY|ALTER|CREATE|GRANT|COMMENT|VALUES)\b/i.test(line));
  if (sqlStart >= 0) lines.splice(sqlStart, lines.length - sqlStart, "[REDACTED]");
  text = lines.join("\n");
  const variants = privateValues.flatMap(value => value ? [
    value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1),
    value.replace(/[\\']/g, "\\$&"), value.replace(/'/g, "''"),
    ...value.split(/\r?\n/).filter(Boolean),
  ] : []).sort((a, b) => b.length - a.length);
  for (const value of new Set(variants)) {
    text = text.split("[REDACTED]").map(part => part.split(value).join("[REDACTED]")).join("[REDACTED]");
  }
  return text;
}

export function probeDatabaseTcp(host: string, port: number, timeoutMs = 2_000): Promise<BackupRuntimeDiagnostics["databaseTcp"]> {
  return new Promise(resolve => {
    const socket = new Socket();
    let finished = false;
    const finish = (result: BackupRuntimeDiagnostics["databaseTcp"]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ reachable: false, status: "timeout" }), timeoutMs);
    socket.once("connect", () => finish({ reachable: true, status: "reachable" }));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      const status = error.code === "ECONNREFUSED" ? "refused"
        : ["ENOTFOUND", "EAI_AGAIN"].includes(error.code ?? "") ? "dns_failed"
          : error.code === "ETIMEDOUT" ? "timeout"
            : ["EHOSTUNREACH", "ENETUNREACH"].includes(error.code ?? "") ? "unreachable" : "error";
      finish({ reachable: false, status });
    });
    try { socket.connect({ host, port }); }
    catch { finish({ reachable: false, status: "error" }); }
  });
}

function probeVersion(binary: string, libraryPath?: string, pathEnv = process.env.PATH) {
  return new Promise<Pick<BackupRuntimeDiagnostics["binary"], "version" | "versionStatus">>(resolve => {
    // --version does not need credentials. Do not inherit application secrets
    // or PG* variables for this subprocess.
    execFile(binary, ["--version"], {
      timeout: 2_000, killSignal: "SIGKILL", maxBuffer: 4_096,
      env: { PATH: pathEnv, LD_LIBRARY_PATH: libraryPath, LANG: "C", LC_ALL: "C" },
    }, (error, stdout) => {
      const version = stdout.match(/^pg_dump \(PostgreSQL\) \d+(?:\.\d+){0,2}\b/)?.[0] ?? null;
      resolve(error
        ? { version: null, versionStatus: error.killed ? "timeout" : "unavailable" }
        : { version, versionStatus: version ? "ok" : "unrecognized" });
    });
  });
}

export async function collectBackupRuntimeDiagnostics(input: {
  binary: string; bundledExists: boolean; libraryPath?: string;
  host: string; port: number; stderr: string; stderrTruncated: boolean;
  privateValues: readonly string[];
}): Promise<BackupRuntimeDiagnostics> {
  const exists = path.isAbsolute(input.binary) ? existsSync(input.binary)
    : (process.env.PATH ?? "/usr/bin:/bin").split(path.delimiter).some(dir => existsSync(path.resolve(dir || ".", input.binary)));
  const [version, databaseTcp] = await Promise.all([
    probeVersion(input.binary, input.libraryPath),
    probeDatabaseTcp(input.host, input.port),
  ]);
  return {
    stderr: redactBackupStderr(input.stderr, input.privateValues, input.stderrTruncated),
    stderrTruncated: input.stderrTruncated,
    binary: { exists, bundledExists: input.bundledExists, source: input.bundledExists ? "bundled" : "PATH", ...version },
    databaseTcp,
  };
}

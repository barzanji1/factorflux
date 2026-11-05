import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { operationsS3 } from "./operationsS3";
import { backupFailureEmail, describeBackupFailure, pgDumpFailure } from "./backupDiagnostics";
import { dumpDatabase, runDatabaseBackup } from "./databaseBackup";
import { SqlBackupError } from "./sqlBackup";

const privateText = "postgresql://private-user:SYNTHETIC_PASSWORD@private-host.invalid/private-db INSERT INTO private_table VALUES ('PRIVATE_CONTENT');";
function assertPrivateTextAbsent(output: string) {
  for (const text of ["postgresql://", "private-user", "SYNTHETIC_PASSWORD", "private-host", "private-db", "INSERT INTO", "PRIVATE_CONTENT"]) {
    assert.ok(!output.includes(text), `Unexpected private content: ${text}`);
  }
}

test("SQL export failures retain safe codes and never upload partial files", async t => {
  const captured = t.mock.method(console,"error",()=>{});
  try {
    for (const code of ["SQL_EXPORT_UNSUPPORTED","SQL_EXPORT_FAILED","SQL_EXPORT_TIMEOUT"] as const) {
      const failure=new SqlBackupError(code);
      failure.exportStep="table-data";
      failure.sqlState="42501";
      const described=describeBackupFailure("sql-export",failure);
      assert.equal(described.code,code);
      assert.equal(described.sqlState,"42501");
      assert.equal(described.exportStep,"table-data");
      let alerts=0;
      await assert.rejects(runDatabaseBackup({
        lock:work=>work(),
        dump:async()=>{throw failure;},
        upload:async()=>assert.fail("Failed SQL exports must never upload"),
        list:async()=>{assert.fail("Failed SQL exports must never prune");},
        alert:async event=>{alerts++;assert.equal(event.code,code);},
      }),{code});
      assert.equal(alerts,1);
    }
    const forged=new SqlBackupError("SQL_EXPORT_FAILED");
    forged.sqlState=privateText;
    forged.exportStep=privateText;
    assertPrivateTextAbsent(JSON.stringify(describeBackupFailure("sql-export",forged)));
  } finally { captured.mock.restore(); }
});

const cases = [
  ["server version mismatch", "CLIENT_VERSION_MISMATCH"],
  ["password authentication failed", "AUTHENTICATION_FAILED"],
  ["no password supplied", "AUTHENTICATION_FAILED"],
  ["permission denied for table", "DATABASE_PERMISSION_DENIED"],
  ["must be owner of table", "DATABASE_PERMISSION_DENIED"],
  ['database "private-db" does not exist', "DATABASE_NOT_FOUND"],
  ["could not translate host name", "DATABASE_CONNECTION_FAILED"],
  ["connection to server failed", "DATABASE_CONNECTION_FAILED"],
  ["server closed the connection unexpectedly", "DATABASE_CONNECTION_FAILED"],
  ["SSL error", "TLS_FAILED"],
  ["certificate verify failed", "TLS_FAILED"],
  ["error while loading shared libraries", "CLIENT_LIBRARY_FAILED"],
  ["version GLIBC_2.99 not found", "CLIENT_LIBRARY_FAILED"],
  ["version OPENSSL_3.2.0 not found", "CLIENT_LIBRARY_FAILED"],
  ["unrecognized error", "DUMP_EXIT_FAILED"],
] as const;

for (const [stderr, code] of cases) {
  test(`pg_dump diagnostics classify ${code} without exposing stderr`, () => {
    const error = pgDumpFailure(`${stderr}\n${privateText}`, { exitCode: 1 });
    const failure = describeBackupFailure("pg_dump", error);
    assert.equal(failure.code, code);
    assert.equal(failure.exitCode, 1);
    assertPrivateTextAbsent(JSON.stringify({ error, failure, message: error.message, email: backupFailureEmail(failure) }));
    assertPrivateTextAbsent(backupFailureEmail({ ...failure, reason: privateText }));
  });
}

test("launch, loader, permission, timeout and signal failures have distinct safe codes", () => {
  for (const [options, code] of [
    [{ launchCode: "ENOENT", bundled: false }, "CLIENT_NOT_FOUND"],
    [{ launchCode: "ENOENT", bundled: true }, "CLIENT_RUNTIME_MISSING"],
    [{ launchCode: "EACCES" }, "CLIENT_EXECUTION_DENIED"],
    [{ launchCode: "EPERM" }, "CLIENT_EXECUTION_DENIED"],
    [{ launchCode: privateText }, "CLIENT_START_FAILED"],
    [{ timedOut: true, signal: "SIGKILL" }, "DUMP_TIMEOUT"],
    [{ signal: "SIGTERM" }, "DUMP_TERMINATED"],
    [{ signal: privateText }, "DUMP_TERMINATED"],
  ] as const) {
    const failure = describeBackupFailure("pg_dump", pgDumpFailure(privateText, options));
    assert.equal(failure.code, code);
    assertPrivateTextAbsent(JSON.stringify(failure) + backupFailureEmail(failure));
  }
});

test("lock, S3 and filesystem errors expose only allow-listed categories", () => {
  for (const [stage, code, expected] of [
    ["lock", "28P01", "AUTHENTICATION_FAILED"],
    ["lock", "42501", "DATABASE_PERMISSION_DENIED"],
    ["lock", "ECONNREFUSED", "DATABASE_CONNECTION_FAILED"],
    ["temporary-file", "ENOSPC", "LOCAL_STORAGE_FULL"],
    ["pg_dump", "EACCES", "LOCAL_PERMISSION_DENIED"],
    ["s3:PutObject", "AccessDenied", "S3_ACCESS_DENIED"],
    ["s3:ListBucket", "AccessDenied", "S3_ACCESS_DENIED"],
    ["s3:DeleteObject", "AccessDenied", "S3_ACCESS_DENIED"],
    ["s3:PutObject", "InvalidAccessKeyId", "S3_CREDENTIALS_INVALID"],
    ["s3:PutObject", "ExpiredToken", "S3_CREDENTIALS_INVALID"],
    ["s3:PutObject", privateText, "S3_REQUEST_FAILED"],
    ["lock", privateText, "BACKUP_FAILED"],
  ] as const) {
    const failure = describeBackupFailure(stage, { code, name: privateText, message: privateText });
    assert.equal(failure.code, expected);
    assert.equal(failure.stage, stage);
    assertPrivateTextAbsent(JSON.stringify(failure) + backupFailureEmail(failure));
  }
});

test("unknown exceptions and primitive thrown values cannot leak into diagnostics", () => {
  for (const value of [null, undefined, privateText, new Error(privateText), { name: privateText, code: privateText, message: privateText }]) {
    const failure = describeBackupFailure("pg_dump", value);
    assert.equal(failure.code, "BACKUP_FAILED");
    assertPrivateTextAbsent(JSON.stringify(failure) + backupFailureEmail(failure));
  }
});

test("real child stderr split across chunks is classified; logs and email omit private data", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-diagnostics-test-"));
  const logs: unknown[][] = [];
  const captured = t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  let alertText = "", alerts = 0, uploads = 0, lists = 0, deletions = 0;
  try {
    const executable = path.join(dir, "fake-pg-dump");
    await writeFile(executable, `#!/usr/bin/env node
process.stderr.write("pg_dump: error: password auth");
setTimeout(() => {
  process.stderr.write(${JSON.stringify(`entication failed\n${privateText}`)});
  process.stdout.write("PARTIAL_PRIVATE_DUMP");
  process.exitCode = 1;
}, 15);
`, { mode: 0o700 });
    await assert.rejects(runDatabaseBackup({
      lock: work => work(),
      dump: file => dumpDatabase(file, "postgresql://synthetic:synthetic@example.invalid/db", executable),
      upload: async () => { uploads++; },
      list: async () => { lists++; return []; },
      remove: async () => { deletions++; },
      alert: async failure => { alerts++; alertText = backupFailureEmail(failure); },
    }), { name: "PgDumpFailure", code: "AUTHENTICATION_FAILED" });
    assert.equal(alerts, 1);
    assert.equal(uploads + lists + deletions, 0);
    assert.match(alertText, /Stage: sql-export/);
    assert.match(alertText, /AUTHENTICATION_FAILED/);
    assert.match(alertText, /pg_dump exit code: 1/);
    assert.equal(logs.length, 1);
    assertPrivateTextAbsent(JSON.stringify(logs) + alertText);
    assert.ok(!JSON.stringify(logs).includes("PARTIAL_PRIVATE_DUMP"));
  } finally {
    captured.mock.restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing executable loader and timeout are observable without a database connection", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-launch-test-"));
  try {
    const executable = path.join(dir, "fake-pg-dump");
    await writeFile(executable, "#!/nonexistent-backup-test-interpreter\n", { mode: 0o700 });
    await assert.rejects(dumpDatabase(path.join(dir, "missing.gz"),
      "postgresql://synthetic:synthetic@example.invalid/db", executable),
    { name: "PgDumpFailure", code: "CLIENT_NOT_FOUND" });
    await writeFile(executable, "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n", { mode: 0o700 });
    await assert.rejects(dumpDatabase(path.join(dir, "timeout.gz"),
      "postgresql://synthetic:synthetic@example.invalid/db", executable, 100),
    { name: "PgDumpFailure", code: "DUMP_TIMEOUT", signal: "SIGKILL" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial S3 retention denial retains its safe category, not provider messages or keys", async t => {
  const logs: unknown[][] = [];
  const logger = t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const sdk = t.mock.method(operationsS3, "send", async (command: unknown) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    return { Errors: [{ Code: "AccessDenied", Message: privateText, Key: privateText }] };
  });
  let alertText = "";
  try {
    await assert.rejects(runDatabaseBackup({
      lock: work => work(),
      dump: async file => { await writeFile(file, gzipSync("SELECT 1;")); },
      upload: async () => {},
      list: async () => Array.from({ length: 31 }, (_, i) =>
        `backups/db/factorflux-2026-01-${String(i + 1).padStart(2, "0")}-030000.sql.gz`),
      alert: async failure => { alertText = backupFailureEmail(failure); },
    }), /S3 backup retention deletion failed/);
    assert.equal(sdk.mock.callCount(), 1);
    assert.match(alertText, /Stage: s3:DeleteObject/);
    assert.match(alertText, /S3_ACCESS_DENIED/);
    assertPrivateTextAbsent(alertText + JSON.stringify(logs));
  } finally {
    sdk.mock.restore();
    logger.mock.restore();
  }
});

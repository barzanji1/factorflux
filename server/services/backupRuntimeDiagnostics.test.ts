import test from "node:test";
import assert from "node:assert/strict";
import { createServer, Socket } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { redactBackupStderr, probeDatabaseTcp, STDERR_LIMIT, collectBackupRuntimeDiagnostics } from "./backupRuntimeDiagnostics";
import { dumpDatabase, runDatabaseBackup } from "./databaseBackup";
import { backupFailureEmail } from "./backupDiagnostics";

test("stderr retains the real error but replaces URI and conninfo credentials", () => {
  for (const connection of [
    "postgresql://unknown:URI_PASSWORD@example.invalid/db?sslmode=require",
    "'postgres://unknown:URI_PASSWORD@example.invalid/db'",
    "jdbc:postgresql://example.invalid/db?password=URI_PASSWORD",
    "host=example.invalid port=5432 dbname=db user=unknown password='URI_PASSWORD'",
    `password="URI_PASSWORD"`,
    `"password": "URI_PASSWORD"`,
    "PGPASSWORD=URI_PASSWORD",
    "connectionString='host=example.invalid password=URI_PASSWORD'",
    "connstr='host=example.invalid user=unknown password=URI_PASSWORD'",
    "postgresql:\\/\\/unknown:URI_PASSWORD@example.invalid/db",
    "postgresql%3A%2F%2Funknown%3AURI_PASSWORD%40example.invalid%2Fdb",
    `password='MULTILINE\nURI_PASSWORD'`,
    `password='UNFINISHED\nURI_PASSWORD`,
  ]) {
    const output = redactBackupStderr(`pg_dump: error: connection refused\n${connection}`, []);
    assert.match(output, /connection refused/);
    assert.match(output, /\[REDACTED\]/);
    assert.ok(!output.includes("URI_PASSWORD"), output);
    assert.ok(!output.includes("postgresql://") && !output.includes("postgres://"), output);
    assert.ok(!output.includes("host=example.invalid"), output);
  }
});

test("known passwords, encoded/escaped forms and configured identifiers are redacted", () => {
  const secret = "s3cr'et\\with space%";
  for (const value of [
    secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1),
    secret.replace(/[\\']/g, "\\$&"), secret.replace(/'/g, "''"),
  ]) {
    const output = redactBackupStderr(`pg_dump: rejected ${value} on private-host for private-user`, [secret, "private-host", "private-user"]);
    assert.ok(!output.includes(value));
    assert.ok(!output.includes("private-host") && !output.includes("private-user"));
    assert.match(output, /\[REDACTED\]/);
  }
  // A password that happens to be part of a URI scheme must not defeat URI
  // recognition. Structural redaction runs before literal replacement.
  assert.equal(redactBackupStderr("postgresql://other:UNKNOWN_SECRET@host/db", ["postgres"]), "[REDACTED]");
});

test("SQL/data, control characters and overflowing stderr do not reach the log", () => {
  const output = redactBackupStderr("pg_dump: error: permission denied\npg_dump: detail: Query was: SELECT secret\nPRIVATE_ROW", []);
  assert.match(output, /permission denied/);
  assert.ok(!output.includes("SELECT") && !output.includes("PRIVATE_ROW"));
  assert.ok(!redactBackupStderr("pg_dump: error: COPY failed\nCONTEXT: COPY private_table\nPRIVATE_ROW", []).includes("PRIVATE_ROW"));
  assert.equal(redactBackupStderr("rejected \x1b[31mPRIVATE_PASSWORD\x1b[0m", ["PRIVATE_PASSWORD"]), "rejected [REDACTED]");
  assert.match(redactBackupStderr("partial password prefix", [], true), /^\[REDACTED\]/);
  const long = redactBackupStderr("SECRET".repeat(STDERR_LIMIT), []);
  assert.ok(!long.includes("SECRET"));
  assert.ok(long.length < 100);
  assert.match(redactBackupStderr("password='" + "\\".repeat(12_000), []), /\[REDACTED\]/);
});

async function localListener() {
  let bytes = 0;
  const server = createServer(socket => { socket.on("data", chunk => { bytes += chunk.length; }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    bytes: () => bytes,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test("TCP check opens and closes a socket without sending credentials or bytes", async () => {
  const listener = await localListener();
  try {
    assert.deepEqual(await probeDatabaseTcp("127.0.0.1", listener.port), { reachable: true, status: "reachable" });
  } finally { await listener.close(); }
  assert.equal(listener.bytes(), 0);
  assert.deepEqual(await probeDatabaseTcp("127.0.0.1", listener.port), { reachable: false, status: "refused" });
});

test("TCP check has a hard deadline even if connection establishment stalls", async t => {
  const connect = t.mock.method(Socket.prototype, "connect", function(this: Socket) { return this; });
  try {
    assert.deepEqual(await probeDatabaseTcp("unused.invalid", 5432, 10), { reachable: false, status: "timeout" });
  } finally { connect.mock.restore(); }
});

test("failed export logs redacted stderr, binary version/existence and TCP result; email stays category-only", async t => {
  const listener = await localListener();
  const dir = await mkdtemp(path.join(tmpdir(), "backup-runtime-test-"));
  const logs: unknown[][] = [];
  const logger = t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  let alert = "";
  try {
    const binary = path.join(dir, "fake-pg-dump");
    await writeFile(binary, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  if (Object.keys(process.env).some(k => /^(PG|AWS_|ANTHROPIC_|DATABASE_URL|NEON_DATABASE_URL)/.test(k))) process.exit(3);
  console.log("pg_dump (PostgreSQL) 18.6");
  console.log("PRIVATE_VERSION_OUTPUT");
} else {
  process.stderr.write('pg_dump: error: password authentication failed\\npostgresql://PRIVATE_USER:PRIVATE_PASSWORD@127.0.0.1/db\\nQuery was: SELECT PRIVATE_ROW\\n');
  process.exitCode = 1;
}
`, { mode: 0o700 });
    await assert.rejects(runDatabaseBackup({
      lock: work => work(),
      dump: file => dumpDatabase(file, `postgresql://PRIVATE_USER:PRIVATE_PASSWORD@127.0.0.1:${listener.port}/db`, binary),
      upload: async () => assert.fail("A failed export must not upload"),
      alert: async failure => { alert = backupFailureEmail(failure); },
    }), { code: "AUTHENTICATION_FAILED" });
    const record = logs[0]?.[1] as { exitCode: number; runtime: Awaited<ReturnType<typeof collectBackupRuntimeDiagnostics>> };
    assert.equal(record.exitCode, 1);
    assert.equal(record.runtime.binary.exists, true);
    assert.equal(record.runtime.binary.bundledExists, true);
    assert.equal(record.runtime.binary.version, "pg_dump (PostgreSQL) 18.6");
    assert.equal(record.runtime.databaseTcp.reachable, true);
    assert.match(record.runtime.stderr, /password authentication failed/);
    assert.match(record.runtime.stderr, /\[REDACTED\]/);
    const serialized = JSON.stringify(logs);
    for (const text of ["PRIVATE_USER", "PRIVATE_PASSWORD", "PRIVATE_VERSION_OUTPUT", "PRIVATE_ROW", "postgresql://", "127.0.0.1"]) {
      assert.ok(!serialized.includes(text), text);
    }
    assert.ok(!alert.includes("stderr"));
    assert.match(alert, /AUTHENTICATION_FAILED/);
  } finally {
    logger.mock.restore();
    await listener.close();
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(listener.bytes(), 0);
});

test("missing client probe returns evidence, not raw launch errors", async () => {
  const listener = await localListener();
  try {
    const result = await collectBackupRuntimeDiagnostics({
      binary: "/nonexistent-backup-client/pg_dump", bundledExists: false,
      host: "127.0.0.1", port: listener.port, stderr: "", stderrTruncated: false, privateValues: [],
    });
    assert.equal(result.binary.exists, false);
    assert.equal(result.binary.version, null);
    assert.equal(result.binary.versionStatus, "unavailable");
    assert.equal(result.databaseTcp.reachable, true);
    assert.ok(!JSON.stringify(result).includes("127.0.0.1"));
  } finally { await listener.close(); }
});

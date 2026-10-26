import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { backupKey, obsoleteBackups, runDatabaseBackup, dumpDatabase, BackupInProgressError, directBackupConnectionUrl } from "./databaseBackup";

test("Neon backups use direct connections, preserving the database and credentials", () => {
  const source = new URL("postgresql://test:synthetic-password@ep-example-pooler.us-east-2.aws.neon.tech/test-db?sslmode=require&channel_binding=require");
  const direct = new URL(directBackupConnectionUrl(source.toString()));
  assert.equal(direct.hostname, "ep-example.us-east-2.aws.neon.tech");
  assert.equal(direct.username, source.username);
  assert.equal(direct.password, source.password);
  assert.equal(direct.pathname, source.pathname);
  assert.equal(direct.search, source.search);
  assert.equal(directBackupConnectionUrl(direct.toString()), direct.toString());
  assert.equal(new URL(directBackupConnectionUrl("postgresql://test:synthetic@example-pooler.other.invalid/db")).hostname,
    "example-pooler.other.invalid");
});

test("UTC filenames and retention keep exactly the newest 30 matching objects", () => {
  assert.equal(backupKey(new Date("2026-10-26T03:04:05Z")), "backups/db/factorflux-2026-10-26-030405.sql.gz");
  const keys = Array.from({ length: 35 }, (_, i) =>
    backupKey(new Date(Date.UTC(2026, 0, i + 1))));
  const deleted = obsoleteBackups([...keys, keys[0], "backups/db/keep.txt", "invoices/file.pdf"]);
  assert.deepEqual(deleted.sort(), keys.slice(0, 5).sort());
});

test("successful dump is uploaded before retention; temporary files are removed", async () => {
  const events: string[] = [];
  let tempFile = "";
  const result = await runDatabaseBackup({
    now: () => new Date("2026-10-26T03:04:05Z"),
    lock: work => work(),
    dump: async file => { tempFile = file; await writeFile(file, gzipSync("SELECT 1;")); events.push("dump"); },
    upload: async (_key, file, bytes) => {
      assert.equal(gunzipSync(await readFile(file)).toString(), "SELECT 1;");
      assert.ok(bytes > 0); events.push("upload");
    },
    list: async () => { events.push("list"); return Array.from({ length: 31 }, (_, i) => backupKey(new Date(Date.UTC(2026, 0, i + 1)))); },
    remove: async keys => { assert.equal(keys.length, 1); events.push("delete"); },
    alert: async () => { assert.fail("Success must not send alerts"); },
  });
  assert.deepEqual(events, ["dump", "upload", "list", "delete"]);
  assert.equal(result.deleted, 1);
  assert.equal(result.bucket, "factorflux-documents-tpf");
  await assert.rejects(stat(tempFile), { code: "ENOENT" });
});

for (const stage of ["dump", "upload", "retention"] as const) {
  test(`${stage} failure rejects, alerts once, and cleans up`, async () => {
    let alerts = 0, uploads = 0, deletions = 0, filePath = "";
    await assert.rejects(runDatabaseBackup({
      lock: work => work(),
      dump: async file => {
        filePath = file;
        await writeFile(file, gzipSync("SELECT 1;"));
        if (stage === "dump") throw new Error("dump failed");
      },
      upload: async () => { uploads++; if (stage === "upload") throw new Error("upload failed"); },
      list: async () => { throw new Error("retention failed"); },
      remove: async () => { deletions++; },
      alert: async () => { alerts++; },
    }), new RegExp(`${stage} failed`));
    assert.equal(alerts, 1);
    assert.equal(uploads, stage === "dump" ? 0 : 1);
    assert.equal(deletions, 0);
    await assert.rejects(stat(filePath), { code: "ENOENT" });
  });
}

test("lock/connection failures alert; overlapping jobs do not send false failure alerts", async () => {
  let alerts = 0;
  await assert.rejects(runDatabaseBackup({
    lock: async () => { throw new Error("Connection failed"); },
    alert: async () => { alerts++; },
  }), /Connection failed/);
  await assert.rejects(runDatabaseBackup({
    lock: async () => { throw new BackupInProgressError(); },
    alert: async () => { alerts++; },
  }), BackupInProgressError);
  assert.equal(alerts, 1);
});

test("pg_dump streams valid gzip and uses libpq env, not credential-bearing arguments", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-test-"));
  try {
    const executable = path.join(dir, "fake-pg-dump");
    await writeFile(executable, `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") !== "--no-password" ||
    process.env.PGDATABASE !== "test-db" ||
    process.env.PGHOST !== "ep-example.us-east-2.aws.neon.tech" ||
    process.env.PGPASSWORD !== "synthetic-password") process.exit(2);
process.stdout.write("SELECT 1;");
`, { mode: 0o700 });
    const file = path.join(dir, "backup.gz");
    await dumpDatabase(file, "postgresql://test:synthetic-password@ep-example-pooler.us-east-2.aws.neon.tech/test-db", executable);
    assert.equal(gunzipSync(await readFile(file)).toString(), "SELECT 1;");
    await writeFile(executable, "#!/usr/bin/env node\nprocess.stdout.write('partial'); process.exit(2);", { mode: 0o700 });
    await assert.rejects(dumpDatabase(path.join(dir, "failed.gz"),
      "postgresql://test:synthetic-password@example.invalid/test-db", executable), /pg_dump failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

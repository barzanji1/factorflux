import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerBackupRoute, registerHealthRoute } from "./maintenance";
import { createHealthHandler } from "../services/health";
import { BackupInProgressError } from "../services/databaseBackup";

async function serve(
  checks: Parameters<typeof createHealthHandler>[0],
  backup: Parameters<typeof registerBackupRoute>[2],
  work: (base: string) => Promise<void>,
) {
  const app = express();
  registerHealthRoute(app, createHealthHandler(checks));
  registerBackupRoute(app, (req, res, next) => {
    const role = req.header("x-test-role");
    if (!role) { res.status(401).json({ message: "Authentication required" }); return; }
    Object.assign(req, { user: { role } });
    next();
  }, backup);
  // A SPA fallback must not intercept health or backup requests.
  app.use((_req, res) => res.type("html").send("<!DOCTYPE html>"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("health is public JSON, probes both dependencies, and coalesces requests", async () => {
  let db = 0, s3 = 0;
  await serve({
    db: async () => { db++; }, s3: async () => { s3++; },
  }, async () => { throw new Error("Must not back up"); }, async base => {
    const responses = await Promise.all([fetch(`${base}/api/health`), fetch(`${base}/api/health`)]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, "ok");
      assert.equal(body.db, true);
      assert.equal(body.s3, true);
      assert.ok(Number.isFinite(Date.parse(body.timestamp)));
    }
    assert.equal(db, 1); assert.equal(s3, 1);
  });
});

for (const failure of ["db", "s3"] as const) {
  test(`health returns 503 without leaking ${failure} errors`, async () => {
    await serve({
      db: async () => { if (failure === "db") throw new Error("private database details"); },
      s3: async () => { if (failure === "s3") throw new Error("private AWS details"); },
    }, undefined, async base => {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body[failure], false);
      assert.equal(body[failure === "db" ? "s3" : "db"], true);
      assert.equal(body.status, "error");
      assert.equal(Object.keys(body).length, 4);
    });
  });
}

test("backup requires an admin role, including rejecting delegated managers", async () => {
  let calls = 0;
  await serve({ db: async () => {}, s3: async () => {} }, async () => {
    calls++;
    return { bucket: "factorflux-documents-tpf", key: "backups/db/test.sql.gz", bytes: 100, deleted: 0 };
  }, async base => {
    for (const [role, status] of [["", 401], ["employee", 403], ["manager", 403], ["admin", 201]] as const) {
      const response = await fetch(`${base}/api/admin/backup`, {
        method: "POST", headers: role ? { "x-test-role": role } : {},
      });
      assert.equal(response.status, status);
      assert.match(response.headers.get("content-type") || "", /json/);
    }
    assert.equal(calls, 1);
  });
});

for (const [error, status] of [[new Error("private failure details"), 500], [new BackupInProgressError(), 409]] as const) {
  test(`backup returns JSON ${status}, never false success`, async () => {
    await serve({ db: async () => {}, s3: async () => {} }, async () => { throw error; }, async base => {
      const response = await fetch(`${base}/api/admin/backup`, { method: "POST", headers: { "x-test-role": "admin" } });
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), /private failure details/);
    });
  });
}

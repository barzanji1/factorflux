import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Request, Response } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requirePermission } from "./requirePermission";

afterEach(() => mock.restoreAll());

async function check(current: { role: string; status: string } | null, permissions: string[], session = true) {
  // All I/O is replaced before invoking the middleware: no database reads,
  // account changes, or permission-denial audit writes are made by these tests.
  mock.method(db, "select", (() => ({
    from: () => ({ where: () => ({ limit: async () => current ? [{ id: "navigation-test", ...current }] : [] }) }),
  })) as any);
  mock.method(storage, "getUserPermissions", async () => permissions);
  mock.method(storage, "createActivity", (async () => ({})) as any);
  const req = { session: session ? { user: { id: "navigation-test", role: "admin" } } : {}, path: "/invoices", method: "GET", originalUrl: "/api/invoices" } as unknown as Request;
  return new Promise<{ status: number; allowed: boolean }>((resolve, reject) => {
    let status = 200;
    const response = {
      status(code: number) { status = code; return this; },
      json() { resolve({ status, allowed: false }); return this; },
    } as unknown as Response;
    void requirePermission("invoices")(req, response, () => resolve({ status, allowed: true })).catch(reject);
  });
}

test("staff APIs reject unauthenticated requests independently of client navigation", async () => {
  assert.deepEqual(await check(null, [], false), { status: 401, allowed: false });
});

test("current database permissions override a stale admin role in the session", async () => {
  assert.deepEqual(await check({ role: "employee", status: "active" }, ["chat"]), { status: 403, allowed: false });
});

test("an explicit smaller grant does not regain permissions from role defaults", async () => {
  assert.deepEqual(await check({ role: "manager", status: "active" }, ["chat"]), { status: 403, allowed: false });
});

test("a current invoice grant authorizes the same API without a navigation permission check", async () => {
  assert.deepEqual(await check({ role: "employee", status: "active" }, ["invoices"]), { status: 200, allowed: true });
});

test("suspended accounts remain blocked even with cached admin credentials", async () => {
  assert.deepEqual(await check({ role: "admin", status: "suspended" }, ["invoices"]), { status: 403, allowed: false });
});

test("removed accounts cannot use the API with an old session", async () => {
  assert.deepEqual(await check(null, ["invoices"]), { status: 401, allowed: false });
});

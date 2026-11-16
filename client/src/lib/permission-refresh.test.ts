import assert from "node:assert/strict";
import { test } from "node:test";
import { createPermissionRefresh, samePermissions } from "./permission-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("unchanged permission sets preserve their snapshot while real revocations differ", () => {
  assert.equal(samePermissions(["invoices", "chat"], ["chat", "invoices"]), true);
  assert.equal(samePermissions(["invoices", "chat"], ["chat"]), false);
  assert.equal(samePermissions(["chat"], ["invoices"]), false);
  assert.equal(samePermissions([], []), true);
});

test("coalesces simultaneous focus and navigation checks without blocking callers on a second request", async () => {
  const refresh = createPermissionRefresh<string[]>(), response = deferred<string[]>();
  let requests = 0;
  const applied: string[][] = [];
  const load = () => { ++requests; return response.promise; };
  const first = refresh.run("staff-a", load, value => applied.push(value), assert.fail);
  const second = refresh.run("staff-a", load, value => applied.push(value), assert.fail);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.deepEqual(applied, []);
  response.resolve(["invoices"]);
  await first;
  assert.deepEqual(applied, [["invoices"]]);
});

test("logout invalidates an in-flight check before it can repopulate permissions", async () => {
  const refresh = createPermissionRefresh<string[]>(), response = deferred<string[]>();
  const applied: string[][] = [];
  const pending = refresh.run("staff-a", () => response.promise, value => applied.push(value), assert.fail);
  refresh.invalidate();
  response.resolve(["admin"]);
  await pending;
  assert.deepEqual(applied, []);
});

test("an older session cannot overwrite a new session's smaller permission set", async () => {
  const refresh = createPermissionRefresh<string[]>(), old = deferred<string[]>();
  const applied: string[][] = [];
  const previous = refresh.run("staff-a", () => old.promise, value => applied.push(value), assert.fail);
  await refresh.run("staff-b", async () => ["tasks"], value => applied.push(value), assert.fail);
  old.resolve(["invoices", "admin"]);
  await previous;
  assert.deepEqual(applied, [["tasks"]]);
});

test("failed checks report the error, do not invent permissions, and allow retry", async () => {
  const refresh = createPermissionRefresh<string[]>();
  const applied: string[][] = [], errors: unknown[] = [];
  await refresh.run("staff-a", async () => { throw new Error("unavailable"); }, value => applied.push(value), error => errors.push(error));
  assert.deepEqual(applied, []);
  assert.equal(errors.length, 1);
  await refresh.run("staff-a", async () => [], value => applied.push(value), error => errors.push(error));
  assert.deepEqual(applied, [[]]);
});

test("synchronous load failures also release the single-flight request", async () => {
  const refresh = createPermissionRefresh<string[]>();
  let failures = 0, commits = 0;
  await refresh.run("staff-a", () => { throw new Error("unavailable"); }, assert.fail, () => { ++failures; });
  await refresh.run("staff-a", async () => [], () => { ++commits; }, assert.fail);
  assert.equal(failures, 1);
  assert.equal(commits, 1);
});

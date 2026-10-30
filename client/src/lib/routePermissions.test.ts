import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToPermission } from "./routePermissions";

test("both follow-up URLs require the same permission", () => {
  assert.equal(pathToPermission("/followups"), "followups");
  assert.equal(pathToPermission("/follow-up"), "followups");
  assert.equal(pathToPermission("/followups/123"), "followups");
  assert.equal(pathToPermission("/follow-up/123"), "followups");
});

test("action-grid destinations retain their existing permission boundaries", () => {
  for (const [path, permission] of [
    ["/invoices", "invoices"],
    ["/sheets", "factoring"],
    ["/reports", "reports"],
    ["/ai-assistant", "earl"],
  ]) assert.equal(pathToPermission(path), permission);
});

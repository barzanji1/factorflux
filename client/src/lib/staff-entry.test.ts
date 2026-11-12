import assert from "node:assert/strict";
import { test } from "node:test";
import { initialStaffPath } from "./staff-entry";

test("anonymous home visits open login without mounting the authenticated loader", () => {
  assert.equal(initialStaffPath("/", null, null), "/login");
  assert.equal(initialStaffPath("/", "false", "{}"), "/login");
  assert.equal(initialStaffPath("/", "true", null), "/login");
});

test("remembered sessions, public routes and deep links retain their existing entry paths", () => {
  assert.equal(initialStaffPath("/", "true", "{}"), "/");
  for (const path of ["/login", "/landing", "/portal", "/portal/login", "/invoices/42", "/unknown"]) {
    assert.equal(initialStaffPath(path, null, null), path);
  }
});

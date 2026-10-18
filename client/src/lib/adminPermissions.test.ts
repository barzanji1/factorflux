import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from "@shared/schema";
import { getPermissionCatalog, getRolePresetPermissions } from "./adminPermissions";

test("admin catalog exposes all 36 registry keys exactly once", () => {
  const keys = getPermissionCatalog().flatMap(group => group.items.map(item => item.key));
  assert.equal(ALL_PERMISSIONS.length, 36);
  assert.deepEqual(keys, [...ALL_PERMISSIONS]);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["calendar", "bulk_sms", "expenses", "chat", "tickets", "client_email"]) assert.ok(keys.includes(key));
});

test("admin preset grants the entire registry including email, other presets preserve shared security defaults", () => {
  assert.deepEqual(getRolePresetPermissions("admin"), [...ALL_PERMISSIONS]);
  for (const role of ["manager", "employee"]) {
    assert.deepEqual(getRolePresetPermissions(role), ALL_PERMISSIONS.filter(key => ROLE_DEFAULT_PERMISSIONS[role].includes(key)));
    assert.equal(getRolePresetPermissions(role).includes("client_email"), false);
  }
});

test("a future registry entry needs no dialog/preset edits to become visible and grantable", () => {
  const future = [...ALL_PERMISSIONS, "future_module"];
  const entry = getPermissionCatalog(future).flatMap(group => group.items).find(item => item.key === "future_module");
  assert.deepEqual(entry, { key: "future_module", label: "Future Module", group: "Other" });
  assert.ok(getRolePresetPermissions("admin", future).includes("future_module"));
});

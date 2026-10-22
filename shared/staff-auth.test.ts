import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaffEmail, staffEmailSchema, staffLoginSchema } from "./staff-auth";

test("staff email is trimmed and case-folded without changing password bytes", () => {
  assert.equal(normalizeStaffEmail("  Alan@Example.COM \n"), "alan@example.com");
  assert.equal(staffEmailSchema.parse("\tNew.Agent@Example.COM "), "new.agent@example.com");
  const password = " Keep.My Password CASE ";
  assert.deepEqual(staffLoginSchema.parse({ username: " USER@Example.COM ", password }), {
    username: "user@example.com", password,
  });
});
test("invalid or missing login fields fail validation instead of producing server errors", () => {
  for (const input of [
    {}, { username: null, password: "valid" }, { username: {}, password: "valid" },
    { username: "not-an-email", password: "valid" }, { username: "a@b.test", password: "" },
    { username: "a@b.test", password: null }, { username: "a@b.test", password: {} },
  ]) assert.equal(staffLoginSchema.safeParse(input).success, false);
});

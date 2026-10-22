import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { users } from "../../shared/schema";
import { createStaffAgent, findStaffByEmail, StaffEmailConflictError, isStaffEmailConflict } from "./staffAccounts";

after(async () => pool.end());
test("legacy account lookup ignores case/spaces, new accounts normalize, and password hashes remain untouched (rollback)", async () => {
  const rollback = new Error("rollback staff identity fixtures");
  await assert.rejects(db.transaction(async tx => {
    const marker = randomUUID();
    const domain = `identity-${marker}.example.test`;
    const password = " Keep-This.Password CASE ";
    const hash = await bcrypt.hash(password, 10);
    const [legacy] = await tx.insert(users).values({
      id: `identity-legacy-${marker}`, email: `  Legacy.Agent@${domain}  `, firstName: "Legacy",
      lastName: "Fixture", role: "employee", status: "active", authType: "local", password: hash, isTestAccount: true,
    }).returning();
    for (const email of [`legacy.agent@${domain}`, `LEGACY.AGENT@${domain.toUpperCase()}`, ` \tLegacy.Agent@${domain}\n`]) {
      const found = await findStaffByEmail(email, tx);
      assert.equal(found?.id, legacy.id);
      assert.equal(found?.password, hash);
      assert.equal(found?.status, "active");
      assert(await bcrypt.compare(password, found!.password!));
      assert.equal(await bcrypt.compare(password.trim(), found!.password!), false);
    }
    const created = await createStaffAgent({
      id: `identity-new-${marker}`, firstName: "New", lastName: "Fixture",
      email: `  New.Agent@${domain.toUpperCase()} `, role: "manager", password: hash, createdBy: legacy.id,
    }, tx);
    assert.equal(created.email, `new.agent@${domain}`);
    assert.equal(created.password, hash);
    assert.equal(created.authType, "local");
    assert.equal(created.status, "active");
    await assert.rejects(createStaffAgent({
      id: `identity-duplicate-${marker}`, firstName: "Duplicate", lastName: "Fixture",
      email: `NEW.AGENT@${domain}`, role: "employee", password: hash, createdBy: legacy.id,
    }, tx), StaffEmailConflictError);
    // The index protects writes that bypass the helper and concurrent requests.
    await assert.rejects(tx.transaction(async inner => {
      await inner.insert(users).values({ id: `identity-race-${marker}`, email: ` NEW.AGENT@${domain} `,
        firstName: "Race", role: "employee", password: hash });
    }), isStaffEmailConflict);
    const [unchanged] = await tx.select().from(users).where(eq(users.id, legacy.id));
    assert.equal(unchanged.email, legacy.email);
    assert.equal(unchanged.password, hash);
    assert.equal(await findStaffByEmail(`missing@${domain}`, tx), undefined);
    throw rollback;
  }), error => error === rollback);
});
test("ambiguous legacy matches never select an arbitrary account", async () => {
  const store: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "one" }, { id: "two" }] }) }) }),
  };
  await assert.rejects(findStaffByEmail("same@example.test", store), StaffEmailConflictError);
  assert(isStaffEmailConflict({ cause: { code: "23505", constraint: "users_normalized_email_unique" } }));
  assert.equal(isStaffEmailConflict({ code: "23505", constraint: "unrelated_unique" }), false);
});

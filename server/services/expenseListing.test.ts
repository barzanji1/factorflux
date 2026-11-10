import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { expenses, users } from "@shared/schema";
import { listExpenses } from "./expenseListing";

test("expense pagination preserves full-scope totals and exports; fixtures always roll back", async () => {
  const rollback = new Error("fixture rollback");
  try {
    const email = process.env.DEV_ADMIN_EMAIL?.trim().toLowerCase();
    assert(email, "Existing development test identity is required");
    const [staff] = await db.select({ id: users.id }).from(users)
      .where(sql`lower(trim(${users.email})) = ${email}`).limit(1);
    assert(staff, "Existing development test identity was not found");
    await db.transaction(async tx => {
      const prefix = `performance-fixture-${randomUUID()}`;
      await tx.insert(expenses).values(Array.from({ length: 31 }, (_, index) => ({
        title: `${prefix}-${index}`, submittedBy: staff.id, category: "other" as const,
        status: "submitted" as const, amountCents: 100, expenseDate: new Date(),
      })));
      const scope = [eq(expenses.submittedBy, staff.id), ilike(expenses.title, `${prefix}%`)];
      const first = await listExpenses(scope, 1, 15, false, tx);
      const second = await listExpenses(scope, 2, 15, false, tx);
      assert(!Array.isArray(first) && !Array.isArray(second));
      assert.equal(first.items.length, 15);
      assert.equal(first.total, 31);
      assert.equal(first.summary.monthTotal, 31);
      assert.equal(first.summary.pending, 31);
      assert.equal(second.items.length, 15);
      assert(!second.items.some(row => first.items.some(previous => previous.id === row.id)));
      const exported = await listExpenses(scope, 1, 15, true, tx);
      assert(Array.isArray(exported));
      assert.equal(exported.length, 31);
      const approved = await listExpenses([and(...scope, eq(expenses.status, "approved"))!], 1, 15, false, tx);
      assert(!Array.isArray(approved));
      assert.equal(approved.total, 0);
      assert.equal(approved.summary.monthTotal, 0);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await pool.end();
  }
});

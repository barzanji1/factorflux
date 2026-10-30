import { after, test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "../db";
import { readDashboardFinancial } from "./dashboardFinancial";

after(() => pool.end());

test("financial summary uses one bounded aggregate query with server-owned staff scope", async () => {
  let queries = 0;
  const store = {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      queries++;
      const compiled = new PgDialect().sqlToQuery(query);
      assert.match(compiled.sql, /coalesce\(i.assigned_to,c.assigned_processor,i.submitted_by\) = \$/);
      assert(compiled.params.includes("isolated-agent"));
      assert.match(compiled.sql, /interval '5 months'/);
      assert.match(compiled.sql, /payment_date/);
      assert.doesNotMatch(compiled.sql, /sum\([^)]*variance/);
      assert.match(compiled.sql, /interval '60 days'/);
      return { rows: [{ kpis: { readyToFund: 5, inReview: 2, openFollowups: 1, aging60Plus: 0, fundedThisWeek: 3, pendingActions: 2 }, months: [] }] };
    },
  } as unknown as typeof db;
  const viewer = { id: "isolated-agent", role: "employee" as const };
  const result = await readDashboardFinancial(viewer, store, new Date("2026-10-29T12:00:00Z"));
  assert.equal(queries, 1);
  assert.deepEqual(result.viewer, viewer);
  assert.equal(result.kpis.readyToFund, 5);
  assert.equal(result.generatedAt, "2026-10-29T12:00:00.000Z");
});

test("financial failures propagate rather than rendering fabricated zero metrics", async () => {
  const store = { execute: async () => { throw Error("aggregate unavailable"); } } as unknown as typeof db;
  await assert.rejects(readDashboardFinancial({ id: "staff", role: "admin" }, store), /aggregate unavailable/);
});

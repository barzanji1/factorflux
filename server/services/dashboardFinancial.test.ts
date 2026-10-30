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
      const collectedSql = compiled.sql.split("), collected AS (")[1]?.split("), open_followups AS (")[0];
      assert.ok(collectedSql, "cash collection aggregation must remain separate from write-offs");
      assert.match(collectedSql, /sum\(applied_amount\)/);
      assert.doesNotMatch(collectedSql, /variance/);
      assert.match(compiled.sql, /interval '60 days'/);
      assert.match(compiled.sql, /LIMIT 3/);
      assert.match(compiled.sql, /variance_type='write_off'/);
      assert.match(compiled.sql, /count\(DISTINCT broker_id\)/);
      assert.match(compiled.sql, /chargeback_status='charged' AND outstanding>0/);
      assert.match(compiled.sql, /due_date<date_trunc\('day',clock.at\)/);
      assert.match(compiled.sql, /due_date>=date_trunc\('day',clock.at\)/);
      return { rows: [{ kpis: { readyToFund: 5, inReview: 2, openFollowups: 1, aging60Plus: 0, fundedThisWeek: 3, pendingActions: 2 }, months: [],
        actionGrid: { docsPending: 2, recentInvoices: [], readyToFundCount: 1, readyToFundAmount: 5,
          openFollowups: 1, overdueFollowups: 1, dueTodayFollowups: 0, openChargebacks: 0,
          chargebackAmount: 0, oldestChargebackDays: null, aging60Count: 0, aging60Amount: 0, brokerCount: 0 } }] };
    },
  } as unknown as typeof db;
  const viewer = { id: "isolated-agent", role: "employee" as const };
  const result = await readDashboardFinancial(viewer, store, new Date("2026-10-29T12:00:00Z"));
  assert.equal(queries, 1);
  assert.deepEqual(result.viewer, viewer);
  assert.equal(result.kpis.readyToFund, 5);
  assert.equal(result.actionGrid.docsPending, 2);
  assert.equal(result.actionGrid.readyToFundAmount, 5);
  assert.equal(result.actionGrid.overdueFollowups, 1);
  assert.equal(result.generatedAt, "2026-10-29T12:00:00.000Z");
});

test("financial failures propagate rather than rendering fabricated zero metrics", async () => {
  const store = { execute: async () => { throw Error("aggregate unavailable"); } } as unknown as typeof db;
  await assert.rejects(readDashboardFinancial({ id: "staff", role: "admin" }, store), /aggregate unavailable/);
});

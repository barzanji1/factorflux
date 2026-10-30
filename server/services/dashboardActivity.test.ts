import { after, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "../db";
import { registerAgentDashboardRoutes } from "../routes/agentDashboard";
import { dashboardReaders } from "./agentDashboard";
import { activityKind, decodeActivityCursor, readDashboardActivityPage } from "./dashboardActivity";

after(() => pool.end());
const viewer = { id: "fixture-a", role: "employee" as const };
const now = new Date("2026-10-29T12:00:00Z");

test("activity categories and cursors reject malformed input without changing staff scope", () => {
  assert.equal(activityKind("invoice_created"), "invoice");
  assert.equal(activityKind("invoice.funded"), "invoice");
  assert.equal(activityKind("invoice_status_changed"), "status");
  assert.equal(activityKind("chargeback_created"), "collection");
  assert.equal(activityKind("broker_collections_resume"), "collection");
  assert.equal(activityKind("document.uploaded"), "document");
  assert.equal(activityKind("settings_updated"), "system");
  for (const value of ["!", "abc", "A".repeat(513), Buffer.from('{"id":1,"second":"invalid"}').toString("base64url")]) {
    assert.throws(() => decodeActivityCursor(value), /Invalid activity cursor/);
  }
});

test("real SQL groups same-second actions without mixing actors/entities and paginates ten groups", async () => {
  const event = (id: number, ms: number, actor = "fixture-a", entityId = 1, eventType = "invoice_status_changed") => ({
    id, event_type: eventType, entity_type: "invoice", entity_id: entityId, actor_id: actor,
    actor_type: "user", created_at: `2026-10-29T10:05:00.${String(ms).padStart(3, "0")}`,
  });
  const events = [
    event(1, 100), event(2, 200), event(3, 300),
    event(4, 400, "fixture-b"), event(5, 500, "fixture-a", 2),
    event(6, 900, "fixture-a", 1, "invoice_funded"),
    ...Array.from({ length: 12 }, (_, index) => ({
      ...event(20 + index, 0), created_at: `2026-10-29T09:59:${String(index).padStart(2, "0")}.000`,
    })),
    event(100, 950, "fixture-test"),
    { ...event(101, 990), actor_type: "system" },
  ];
  let calls = 0;
  // Read-only CTE fixtures shadow source names; no staff, invoices or ledger rows are written.
  const store = { execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    calls++;
    const compiled = new PgDialect().sqlToQuery(query);
    assert.match(compiled.sql, /GROUP BY second,actor_id,event_type,entity_type,entity_id/);
    assert.match(compiled.sql, /LIMIT \$/);
    assert(compiled.params.includes(11));
    const fixtureSql = `WITH event_ledger AS (
      SELECT * FROM jsonb_to_recordset($${compiled.params.length + 1}::jsonb)
      AS t(id int,event_type text,entity_type text,entity_id int,actor_id text,actor_type text,created_at timestamp)
    ), users(id,first_name,last_name,is_test_account) AS (VALUES
      ('fixture-a','Dosh','Fixture',false),('fixture-b','Maria','Fixture',false),('fixture-test','Test','Account',true)
    ), invoices(id,invoice_number) AS (VALUES (1,'INV005'),(2,'INV006')), eligible`;
    return pool.query(compiled.sql.replace("WITH eligible", fixtureSql), [...compiled.params, JSON.stringify(events)]);
  } } as unknown as typeof db;
  const first = await readDashboardActivityPage(viewer, store, now);
  assert.equal(first.activity.length, 10);
  assert(first.nextCursor);
  assert.equal(first.summary.todayCount, 18);
  assert.deepEqual(first.summary.mostActive, { name: "Dosh Fixture", count: 17 });
  assert.equal(first.summary.lastActionAt, "2026-10-29T10:05:00.900Z");
  const grouped = first.activity.find(group => group.id === 1)!;
  assert.equal(grouped.count, 3);
  assert.equal(grouped.events.length, 3);
  assert.equal(grouped.entityLabel, "invoice INV005");
  assert.equal(grouped.href, "/invoices/1");
  assert.equal(grouped.kind, "status");
  assert(first.activity.some(group => group.id === 4 && group.who === "Maria Fixture" && group.count === 1));
  assert(first.activity.some(group => group.id === 5 && group.entityLabel === "invoice INV006"));
  const second = await readDashboardActivityPage(viewer, store, now, { cursor: first.nextCursor! });
  assert.equal(second.activity.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.activity, ...second.activity].map(group => group.id)).size, 16);
  assert.equal([...first.activity, ...second.activity].reduce((n, group) => n + group.count, 0), 18);
  assert.equal(calls, 2);
});

test("activity endpoint accepts only validated pagination cursors and preserves authentication", async () => {
  const app = express();
  const seen: (string | undefined)[] = [];
  registerAgentDashboardRoutes(app, (req: any, res, next) => {
    if (!req.get("x-staff")) return void res.status(401).json({ message: "Login required" });
    req.user = viewer; next();
  }, undefined, {
    ...dashboardReaders,
    activity: async (identity, _store, _now, options) => {
      assert.equal(identity.id, viewer.id);
      seen.push(options?.cursor);
      return { viewer: identity, generatedAt: now.toISOString(), activity: [], nextCursor: null, limit: 10,
        summary: { todayCount: 0, mostActive: null, lastActionAt: null } };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agent-dashboard/activity`;
  const headers = { "x-staff": "yes" };
  const cursor = Buffer.from(JSON.stringify({ second: "2026-10-29T10:05:00.000Z", id: 6 })).toString("base64url");
  try {
    assert.equal((await fetch(root)).status, 401);
    assert.equal((await fetch(`${root}?cursor=${cursor}`, { headers })).status, 200);
    assert.deepEqual(seen, [cursor]);
    for (const query of ["cursor=bad", "cursor=a&cursor=b", "agentId=other", "limit=1000"]) {
      const response = await fetch(`${root}?${query}`, { headers });
      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type")!, /json/);
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { INSIGHT_ENTITIES } from "@shared/page-insights";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { buildInsightQuery, insightDefinitions } from "./pageInsights";
import { emailLogFilters } from "./emailLogReader";

const dialect = new PgDialect();
test("every declared insight entity has a valid static schema definition", () => {
  for (const entity of INSIGHT_ENTITIES) {
    const definition = insightDefinitions[entity], columns = getTableColumns(definition.table);
    for (const key of [definition.amount, definition.state, definition.date, definition.owner].filter(Boolean)) {
      assert(columns[key!], `${entity}: missing ${key}`);
    }
    const compiled = dialect.sqlToQuery(buildInsightQuery(entity, { id: "fixture-admin", role: "admin" }, { clientId: 1 }).query);
    assert.equal((compiled.sql.match(/WITH normalized AS MATERIALIZED/gi) ?? []).length, 1);
    assert(!/encrypted_data|bank_account(?!_id\b)|routing_number|account_number|subject|note_text|password/i.test(compiled.sql));
  }
});
test("employee summaries preserve invoice/task/expense/client-email ownership", () => {
  for (const entity of ["invoices", "tasks", "expenses", "client-email", "documents", "calendar"] as const) {
    const compiled = dialect.sqlToQuery(buildInsightQuery(entity, { id: "staff-query-marker", role: "employee" }).query);
    assert(compiled.params.includes("staff-query-marker"), entity);
    assert(!compiled.sql.includes("staff-query-marker"), "actor must be parameterized");
  }
});
test("vault requires a selected carrier and queries metadata only", () => {
  assert.throws(() => buildInsightQuery("vault", { id: "fixture", role: "admin" }), /carrier/i);
  const compiled = dialect.sqlToQuery(buildInsightQuery("vault", { id: "fixture", role: "employee" }, { clientId: 75 }).query);
  assert(compiled.params.includes(75)); assert(!compiled.sql.includes("encrypted_data"));
});
test("IT triage counts are not exposed to unrelated admins", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("it-support", { id: "not-the-contact", role: "admin" }).query);
  assert(compiled.params.includes("not-the-contact"));
});
test("detail summaries are parameterized and entity-scoped", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("invoices", { id: "fixture", role: "admin" }, { entityId: 92345 }).query);
  assert(compiled.params.includes(92345)); assert.match(compiled.sql, /"invoices"\."id" = \$/);
});
test("email log uses the shared 15-row server default", () => {
  assert.equal(DEFAULT_PAGE_SIZE, 15); assert.equal(emailLogFilters.parse({}).pageSize, DEFAULT_PAGE_SIZE);
});

test("funding summaries use funding dates and the same classified paperwork readiness evidence", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("sheets", { id: "fixture", role: "employee" }).query);
  assert(compiled.params.includes("fixture"));
  for (const evidence of ["funded_at", "ready_to_fund", "classification_source", "ai_document_type", "bank_account_id", "is_active"]) {
    assert(compiled.sql.includes(evidence), evidence);
  }
  assert(compiled.params.includes("Ready to Fund"));
  assert(compiled.sql.includes("state = 'approved' AND ready_to_fund"));
  assert(!compiled.sql.includes("decrypt") && !compiled.sql.includes("encrypted_data"));
});

test("payment values subtract actual application lines rather than guessing from status", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("cash-application", { id: "fixture", role: "admin" }).query);
  assert.match(compiled.sql, /payment_application_lines/);
  assert.match(compiled.sql, /sum\(applied_amount\)/);
  assert.match(compiled.sql, /greatest\(n.amount - coalesce\(a.applied,0\),0\)/);
  assert(compiled.params.includes("Applied This Month") && compiled.params.includes("Unapplied"));
});

test("MC summaries use one latest record per current entity and real run success counts", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("fmcsa-authority", { id: "fixture", role: "admin" }).query);
  assert.match(compiled.sql, /authority_entities AS MATERIALIZED/);
  assert.equal((compiled.sql.match(/ORDER BY checked_at DESC,id DESC LIMIT 1/g) ?? []).length, 2);
  assert.match(compiled.sql, /sum\(n.successful\)/);
  assert(compiled.params.includes("Active Entities") && compiled.params.includes("Unknown"));
});

test("email metrics keep delivery failures separate and group volume by entity type", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("email-log", { id: "fixture", role: "employee" }).query);
  for (const label of ["Total Sent", "Delivered", "Bounced", "Failed", "Volume by type"]) assert(compiled.params.includes(label));
  assert.match(compiled.sql, /n.state IN \('bounced','failed'\)/);
  assert(!compiled.sql.includes("body_preview") && !compiled.sql.includes("to_addresses"));
  assert(!compiled.params.includes("fixture"), "staff-wide log statistics stay staff-wide");
});

test("numeric metadata accepts string user IDs and optional legacy fuel flags", () => {
  const admin = dialect.sqlToQuery(buildInsightQuery("admin", { id: "fixture", role: "admin" }).query);
  assert.match(admin.sql, /"users"\."id"::text/);
  assert(!admin.sql.includes('"users"."id"::int'));
  const fuel = dialect.sqlToQuery(buildInsightQuery("fuel-advance", { id: "fixture", role: "admin" }).query);
  assert(!fuel.sql.includes('"fuel_advances"."paid"'), "older deployments do not have the additive column yet");
  assert.match(fuel.sql, /to_jsonb\("fuel_advances"\)->>'paid'/);
});

test("time tracking has real hours by agent and by day, scoped to the admin section", () => {
  const compiled = dialect.sqlToQuery(buildInsightQuery("admin", { id: "fixture", role: "admin" }, { section: "timetracking" }).query);
  assert(compiled.params.includes("Hours by agent") && compiled.params.includes("Hours by day"));
  assert.match(compiled.sql, /sum\(n.hours\)/);
  assert(!compiled.sql.includes("hourly_rate"));
});

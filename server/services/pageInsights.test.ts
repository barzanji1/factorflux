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
    assert(!/encrypted_data|bank_account|subject|note_text|password/i.test(compiled.sql));
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

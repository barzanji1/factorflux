import { and, eq, getTableColumns, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import type { InsightEntity, PageInsights } from "@shared/page-insights";
import { db } from "../db";
import { IT_CONTACT_USER_ID } from "./itSupport";
import { insightPresentation, insightProjection } from "./pageInsightPresentation";

type Definition = {
  table: AnyPgTable; permission: string; amount?: string; cents?: boolean;
  state?: string; date?: string; metric?: string;
  owner?: string; restricted?: boolean; filter?: SQL;
};
const invoice = { table: schema.invoices, permission: "invoices", amount: "amount", owner: "submittedBy" };
/** Static registry only: request values never become identifiers or SQL fragments. */
export const insightDefinitions: Record<InsightEntity, Definition> = {
  invoices: invoice,
  clients: { table: schema.clients, permission: "carriers", amount: "reserves", metric: "Reserves" },
  brokers: { table: schema.brokers, permission: "brokers", amount: "creditLimit", metric: "Credit limits" },
  documents: { table: schema.documents, permission: "documents", amount: "size", metric: "Stored bytes" },
  followups: { table: schema.followUps, permission: "followups" },
  tasks: { table: schema.tasks, permission: "tasks", owner: "assignedTo" },
  "email-log": { table: schema.emailLog, permission: "all_authenticated" },
  "client-email": { table: schema.clientEmailLogs, permission: "client_email", owner: "agentId" },
  factoring: { ...invoice, permission: "factoring" },
   sheets: { ...invoice, permission: "factoring" },
  payouts: { table: schema.payouts, permission: "payments", amount: "advanceAmount", state: "paymentStatus" },
   "cash-application": { table: schema.cashApplications, permission: "payments", amount: "totalReceived", date: "paymentDate" },
   lockbox: { table: schema.lockboxEntries, permission: "lockbox", amount: "amount", date: "receivedDate" },
   "fuel-advance": { table: schema.fuelAdvances, permission: "fuel_advance", amount: "advanceAmount", date: "advanceDate" },
  "bank-transfers": { table: schema.bankTransfers, permission: "bank_transfers", amount: "amount" },
  held: { ...invoice, permission: "held", filter: sql`${schema.invoices.status} = 'held'` },
  exceptions: { table: schema.exceptions, permission: "payments" },
  "credit-checks": { table: schema.creditChecks, permission: "cb_reviews" },
  "fmcsa-authority": { table: schema.complianceIntegrationRuns, permission: "mc_check", date: "startedAt", amount: "totalChecked", metric: "Entities checked" },
  "audit-log": { table: schema.eventLedger, permission: "logs", state: "eventType" },
  activities: { table: schema.activities, permission: "logs", state: "type" },
  reports: { ...invoice, permission: "reports" },
  dispatchers: { table: schema.dispatchers, permission: "dispatchers" },
  trucks: { table: schema.trucks, permission: "trucks" },
  "release-letters": { table: schema.releaseLetters, permission: "release_letters" },
  "bulk-invoices": { table: schema.bulkInvoiceBatches, permission: "bulk_invoices", amount: "totalAmount", owner: "createdBy" },
  "portal-submissions": { table: schema.carrierSubmissions, permission: "portal_submissions", amount: "amount" },
  admin: { table: schema.users, permission: "admin" },
   payroll: { table: schema.payrollEntries, permission: "payroll", amount: "netPay", date: "payPeriodEnd" },
   expenses: { table: schema.expenses, permission: "expenses", amount: "amountCents", cents: true, owner: "submittedBy", date: "expenseDate" },
  vault: { table: schema.clientVault, permission: "vault", state: "isActive" },
  "document-rules": { table: schema.documentRules, permission: "rules", state: "active" },
  "workflow-builder": { table: schema.invoices, permission: "workflow_builder", state: "status", amount: "amount", owner: "submittedBy" },
  calendar: { table: schema.calendarEvents, permission: "calendar", date: "startAt" },
  "it-support": { table: schema.itSupportRequests, permission: "all_authenticated", owner: "submittedByAgentId" },
  tickets: { table: schema.tickets, permission: "tickets" },
  collections: { ...invoice, permission: "followups", filter: sql`${schema.invoices.status} IN ('funded','overdue','partially_paid')` },
  loads: { table: schema.loads, permission: "factoring" },
};

export type InsightInput = { entityId?: number; clientId?: number; section?: string };
export type InsightActor = { id: string; role: string };
export function buildInsightQuery(entity: InsightEntity, actor: InsightActor, input: InsightInput = {}) {
  let definition = insightDefinitions[entity];
  if (entity === "admin" && input.section) {
    const sections: Record<string, Definition> = {
       timetracking: { table: schema.timeEntries, permission: "admin", date: "clockInTime" },
      portal: { table: schema.carrierPortalUsers, permission: "admin" },
      factoring: { ...invoice, permission: "admin" },
      documents: { table: schema.documentRules, permission: "admin", state: "active" },
      audit: { table: schema.activities, permission: "admin", state: "type" },
    };
    definition = sections[input.section] ?? definition;
  }
  const columns = getTableColumns(definition.table);
  const employee = actor.role !== "admin" && actor.role !== "manager";
  const conditions: Array<SQL | undefined> = [definition.filter];
  if (employee && entity !== "it-support" && definition.owner && columns[definition.owner]) conditions.push(eq(columns[definition.owner], actor.id));
  // Triage is restricted to the designated contact, not every manager/admin.
  if (entity === "it-support" && actor.id !== IT_CONTACT_USER_ID) conditions.push(eq(schema.itSupportRequests.submittedByAgentId, actor.id));
  if (entity === "documents" && employee) {
    conditions.push(sql`${schema.documents.invoiceId} IN (SELECT id FROM invoices WHERE submitted_by = ${actor.id})`);
  }
  if (entity === "calendar" && employee) conditions.push(or(
    eq(schema.calendarEvents.createdBy, actor.id), eq(schema.calendarEvents.userId, actor.id), eq(schema.calendarEvents.assignedTo, actor.id),
  ));
  if (entity === "tickets" && employee) conditions.push(or(
    eq(schema.tickets.submittedBy, actor.id), eq(schema.tickets.assignedTo, actor.id),
  ));
  if (entity === "vault") {
    if (!input.clientId) throw new Error("A carrier must be selected");
    conditions.push(eq(schema.clientVault.clientId, input.clientId));
  }
  if (input.entityId && columns.id) conditions.push(eq(columns.id, input.entityId));
  if (input.clientId && entity !== "vault" && columns.clientId) conditions.push(eq(columns.clientId, input.clientId));
  const stateColumn = columns[definition.state ?? "status"];
  const boolState = definition.state === "isActive" || definition.state === "active";
  const state = stateColumn
    ? boolState ? sql`CASE WHEN ${stateColumn} THEN 'active' ELSE 'inactive' END` : sql`coalesce(${stateColumn}::text, 'unknown')`
    : sql`'recorded'::text`;
  const dateColumn = columns[definition.date ?? "createdAt"] ?? columns.updatedAt;
  const date = dateColumn ? sql`${dateColumn}::timestamp` : sql`NULL::timestamp`;
  const amountColumn = definition.amount ? columns[definition.amount] : undefined;
  const amount = amountColumn ? sql`coalesce(${amountColumn}::numeric, 0) / ${definition.cents ? 100 : 1}` : sql`0::numeric`;
  const where = and(...conditions) ?? sql`true`;
  const currency = Boolean(amountColumn) && !["documents", "fmcsa-authority"].includes(entity);
  const open = stateColumn && !["role", "type", "eventType"].includes(definition.state ?? "")
    ? sql`count(*) FILTER (WHERE state NOT IN ('paid','completed','closed','resolved','cancelled','canceled','inactive','suspended','failed','rejected','written_off','charged_back','unknown','posted','void','matched','reserve_released'))`
    : sql`count(*) FILTER (WHERE occurred_at >= current_date)`;
   const presentation = insightPresentation(entity, input.section);
   const query = sql`
    WITH normalized AS MATERIALIZED (
       SELECT ${state} AS state, ${date} AS occurred_at, ${amount} AS amount ${insightProjection(columns, entity)}
      FROM ${definition.table} WHERE ${where}
    ), ranked AS (
      SELECT state, count(*)::int AS value, row_number() OVER (ORDER BY count(*) DESC, state) AS rank
      FROM normalized GROUP BY state
    ), breakdown AS (
      SELECT CASE WHEN rank <= 4 THEN state ELSE 'Other' END AS name, sum(value)::int AS value
      FROM ranked GROUP BY 1
    ), months AS (
      SELECT date_trunc('month', occurred_at) AS period, count(*)::int AS count, sum(amount)::float8 AS amount
      FROM normalized WHERE occurred_at >= date_trunc('month', now()) - interval '5 months'
      GROUP BY 1
    ), series AS (
      SELECT to_char(d, 'YYYY-MM') AS period, coalesce(m.count, 0) AS count, coalesce(m.amount, 0) AS amount
      FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') d
      LEFT JOIN months m ON m.period = d ORDER BY d
     ) ${presentation.ctes}
    SELECT count(*)::int AS total, ${open}::int AS open,
      ${amountColumn ? sql`coalesce(sum(amount), 0)::float8` : sql`count(*) FILTER (WHERE occurred_at BETWEEN now() - interval '30 days' AND now())::float8`} AS metric,
      coalesce((SELECT jsonb_agg(b ORDER BY b.value DESC, b.name) FROM breakdown b), '[]'::jsonb) AS breakdown,
       coalesce((SELECT jsonb_agg(s ORDER BY s.period) FROM series s), '[]'::jsonb) AS series,
       ${presentation.metrics} AS extra_metrics, ${presentation.charts} AS charts
    FROM normalized`;
  return { query, metricLabel: definition.metric ?? (currency ? "Total amount" : "Last 30 days"), format: currency ? "currency" as const : "number" as const,
    openLabel: stateColumn && !["role", "type", "eventType"].includes(definition.state ?? "") ? "Open / active" : "Recorded today" };
}

export async function readPageInsights(entity: InsightEntity, actor: InsightActor, input: InsightInput): Promise<PageInsights> {
  const { query, metricLabel, format, openLabel } = buildInsightQuery(entity, actor, input);
  const result = await db.execute(query);
   const row = result.rows[0] as { total: number; open: number; metric: number; breakdown: PageInsights["breakdown"]; series: PageInsights["series"]; extra_metrics: PageInsights["extraMetrics"]; charts: PageInsights["charts"] };
  return {
    total: Number(row.total), open: Number(row.open), openLabel,
    keyMetric: { label: metricLabel, value: Number(row.metric), format },
     breakdown: row.breakdown, series: row.series,
     ...(row.extra_metrics ? { extraMetrics: row.extra_metrics } : {}),
     ...(row.charts ? { charts: row.charts } : {}),
  };
}

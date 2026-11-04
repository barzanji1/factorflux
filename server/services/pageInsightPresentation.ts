import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { InsightEntity, InsightChart, InsightMetric } from "@shared/page-insights";
import { authorityInsightCte } from "./authorityInsightSql";
import { fundingReadinessSql } from "./fundingReadinessSql";

type Metric = { label: string; expression: SQL; format: InsightMetric["format"] };
type Columns = Record<string, AnyPgColumn>;
const raw = (value: string) => sql.raw(value); // Only developer-authored SQL, never request values.
const count = (where = "true") => raw(`count(*) FILTER (WHERE ${where})`);
const sum = (where = "true", column = "amount") => raw(`coalesce(sum(${column}) FILTER (WHERE ${where}), 0)`);
const metric = (label: string, expression: SQL, format: Metric["format"] = "number"): Metric => ({ label, expression, format });
const state = (value: string) => `state = '${value}'`;
const total = (label: string) => metric(label, count());
const status = (label: string, value: string) => metric(label, count(state(value)));
const money = (label: string, where = "true", column = "amount") => metric(label, sum(where, column), "currency");
const teal = "#27aab8", orange = "#d69543", red = "#c56d60";
const volume: InsightChart["series"] = [{ key: "amount", label: "Amount", color: teal, format: "currency" }];
const records: InsightChart["series"] = [{ key: "count", label: "Count", color: teal }];

function chart(title: string, kind: InsightChart["kind"], data: SQL, series: InsightChart["series"]): SQL {
  return sql`jsonb_build_object('title', ${title}::text, 'kind', ${kind}::text,
    'data', ${data}, 'series', ${JSON.stringify(series)}::jsonb, 'xKey', 'name')`;
}
function distribution(title: string, expression = "state", filter = "true"): SQL {
  return chart(title, "donut", sql`coalesce((SELECT jsonb_agg(b ORDER BY b.value DESC, b.name) FROM (
    SELECT CASE WHEN position <= 4 THEN label ELSE 'Other' END AS name, sum(value)::int AS value FROM (
      SELECT ${raw(expression)} AS label, count(*)::int AS value, row_number() OVER (ORDER BY count(*) DESC, ${raw(expression)}) AS position
      FROM normalized WHERE ${raw(filter)} GROUP BY 1
    ) ranked GROUP BY 1) b), '[]'::jsonb)`,
  [{ key: "value", label: "Count", color: teal }]);
}
/** One bounded series, filled with zeroes; no separate database call per chart. */
function trend(title: string, options: {
  unit?: "day" | "week" | "month"; periods?: number; date?: string; filter?: string;
  kind?: "cylinder" | "area"; series?: InsightChart["series"]; aggregates?: SQL;
} = {}): SQL {
  const { unit = "week", periods = 8, date = "occurred_at", filter = "true", kind = "cylinder", series = volume } = options;
  const floor = raw(`date_trunc('${unit}', now())`), step = raw(`interval '1 ${unit}'`);
  const start = sql`${floor} - ${periods - 1} * ${step}`;
  const data = sql`coalesce((SELECT jsonb_agg(t ORDER BY t.name) FROM (
    SELECT to_char(d, 'YYYY-MM-DD') AS name,
      ${options.aggregates ?? sql`count(n.record_id)::int AS count, coalesce(sum(n.amount),0)::float8 AS amount`}
    FROM generate_series(${start}, ${floor}, ${step}) d
    LEFT JOIN normalized n ON ${raw(`date_trunc('${unit}', n.${date})`)} = d AND ${raw(filter)}
    GROUP BY d) t), '[]'::jsonb)`;
  return chart(title, kind, data, series);
}

/** Numeric metadata only: excludes bodies, notes, addresses, bank and vault contents. */
export function insightProjection(columns: Columns, entity: InsightEntity): SQL {
  const c = (name: string, cast: string, fallback: string) =>
    columns[name] ? sql`${columns[name]}::${raw(cast)}` : raw(fallback);
  return sql`,
    ${c("fundedAt", "timestamp", "NULL::timestamp")} AS funded_at,
    ${c("advancePaidAt", "timestamp", "NULL::timestamp")} AS paid_at,
    ${entity === "sheets" ? fundingReadinessSql : sql`false`} AS ready_to_fund,
    ${c("heldAt", "timestamp", "NULL::timestamp")} AS held_at,
    ${c("dueDate", "timestamp", "NULL::timestamp")} AS due_at,
    ${c("payPeriodEnd", "timestamp", "NULL::timestamp")} AS period_end,
    ${c("employeeId", "text", "NULL::text")} AS employee_key,
    ${c("deductions", "numeric", "0::numeric")} AS deductions,
    ${c("totalHours", "numeric", "0::numeric")} AS hours,
    ${c("chargebackStatus", "text", "'none'::text")} AS chargeback_state,
    ${c("heldReason", "text", "'Unspecified'::text")} AS hold_reason,
    ${c("category", "text", "'other'::text")} AS category,
    ${c("entityType", "text", "'other'::text")} AS entity_type,
    ${c("userId", "text", "NULL::text")} AS staff_id,
    ${columns.paid ? sql`coalesce((to_jsonb(${columns.paid.table})->>'paid')::boolean,false)` : sql`false`} AS is_paid,
    ${c("actorType", "text", "'user'::text")} AS actor_kind,
    ${c("totalChecked", "numeric", "0::numeric")} AS checked,
    ${c("successCount", "numeric", "0::numeric")} AS successful,
    ${c("id", "text", "NULL::text")} AS record_id`;
}

export function insightPresentation(entity: InsightEntity, section?: string): { metrics: SQL; charts: SQL; ctes: SQL } {
  let metrics: Metric[] = [], charts: SQL[] = [];
  switch (entity) {
    case "factoring":
      metrics = [money("Total Invoices"), status("New", "submitted"), status("Docs Pending", "docs_pending"),
        status("Under Review", "under_review"), status("Approved", "approved"), money("Funded", state("funded")),
        status("Held", "held"), metric("Chargebacks", count("chargeback_state = 'charged'"))];
      charts = [distribution("Invoice pipeline"), trend("Daily funding volume", { unit: "day", periods: 14, date: "funded_at" }),
        trend("Approval rate", { kind: "area", series: [{ key: "approved", label: "Approved", color: teal, format: "percent" }],
          aggregates: raw("coalesce(100.0 * count(n.occurred_at) FILTER (WHERE n.state IN ('approved','funded','paid','settled')) / nullif(count(n.occurred_at),0),0)::float8 AS approved") })];
      break;
    case "sheets":
      metrics = [money("Ready to Fund", "state = 'approved' AND ready_to_fund"),
        metric("Pending Review", count("state IN ('submitted','docs_pending','under_review')")),
        money("Funded Today", "funded_at >= current_date"),
        metric("Total in Queue", count("state IN ('submitted','docs_pending','under_review','approved')"))];
      charts = [trend("Daily funding volume — 14 days", { unit: "day", periods: 14, date: "funded_at" }),
        distribution("Queue by status", "state", "state IN ('submitted','docs_pending','under_review','approved')")];
      break;
    case "email-log":
      metrics = [metric("Total Sent", count("state <> 'failed'")), status("Delivered", "delivered"), status("Bounced", "bounced"), status("Failed", "failed")];
      charts = [trend("Weekly delivery outcomes", { series: [
        { key: "delivered", label: "Delivered", color: teal },
        { key: "failed", label: "Bounced + failed", color: red }],
        aggregates: raw("count(n.occurred_at) FILTER (WHERE n.state='delivered')::int AS delivered, count(n.occurred_at) FILTER (WHERE n.state IN ('bounced','failed'))::int AS failed") }),
        distribution("Volume by type", "coalesce(entity_type,'other')")];
      break;
    case "cash-application":
      metrics = [total("Total Payments"),
        metric("Applied This Month", sql`(SELECT coalesce(sum(l.applied_amount),0) FROM payment_application_lines l
          JOIN normalized n ON n.record_id = l.cash_application_id::text WHERE l.created_at >= date_trunc('month',now()))`, "currency"),
        metric("Unapplied", sql`(SELECT coalesce(sum(greatest(n.amount - coalesce(a.applied,0),0)),0) FROM normalized n
          LEFT JOIN (SELECT cash_application_id, sum(applied_amount) AS applied FROM payment_application_lines GROUP BY 1) a ON a.cash_application_id::text=n.record_id)`, "currency"),
        metric("Pending", count("state IN ('unapplied','partially_applied')"))];
      charts = [trend("Weekly payment volume"), distribution("Application status")];
      break;
    case "payouts":
      metrics = [total("Total Payments"), money("Advances Paid This Month", "paid_at >= date_trunc('month',now())"),
        money("Pending Advances", state("pending_advance")), status("Completed", "complete")];
      charts = [trend("Weekly payment volume", { date: "paid_at" }), distribution("Payment status")]; break;
    case "lockbox":
      metrics = [total("Total Entries"), status("Matched", "matched"), status("Unmatched", "unmatched"), metric("Today's Entries", count("occurred_at >= current_date"))];
      charts = [trend("Daily lockbox volume", { unit: "day", periods: 14 }), distribution("Match status")]; break;
    case "fuel-advance":
      metrics = [money("Total Advances"), metric("Active / Open", count("NOT is_paid AND state IN ('pending','approved')")),
        metric("Completed", count("is_paid OR state = 'paid'")), metric("Average Advance", raw("avg(amount)"), "currency")];
      charts = [trend("Weekly advance volume"), distribution("Advance status", "CASE WHEN is_paid THEN 'paid' ELSE state END")]; break;
    case "bank-transfers":
      metrics = [total("Total Transfers"), metric("Pending", count("state IN ('pending','processing')")), money("Completed", state("completed")), status("Failed", "failed")];
      charts = [trend("Weekly transfer volume"), distribution("Transfer status")]; break;
    case "dispatchers":
      metrics = [total("Total Dispatchers"), status("Active", "active")];
      charts = [distribution("Dispatcher status")]; break;
    case "trucks":
      metrics = [total("Total Trucks"), status("Active", "active"), metric("Inactive / Out of Service", count("state IN ('inactive','out-of-service')"))];
      charts = [distribution("Fleet status")]; break;
    case "release-letters":
      metrics = [total("Total Letters"), metric("Generated This Month", count("occurred_at >= date_trunc('month',now())"))];
      charts = [trend("Letters generated", { series: records }), distribution("Letter status")]; break;
    case "credit-checks":
      metrics = [total("Total Reviews"), status("Pending", "pending"), metric("Approved", count("state IN ('approved','approved_with_conditions')")), status("Rejected", "declined")];
      charts = [trend("Weekly review volume", { series: records }), distribution("Review outcomes")]; break;
    case "held":
      metrics = [total("Total Held"), metric("Average Hold Duration", raw("avg(greatest(extract(epoch FROM now()-held_at)/86400,0)) FILTER (WHERE held_at IS NOT NULL)"), "days"),
        metric("Oldest Hold", raw("max(greatest(extract(epoch FROM now()-held_at)/86400,0))"), "days")];
      charts = [distribution("Hold reasons", "coalesce(nullif(hold_reason,''),'Unspecified')"),
        chart("Hold duration", "cylinder", sql`coalesce((SELECT jsonb_agg(b ORDER BY b.name) FROM (
          SELECT CASE WHEN held_at IS NULL THEN 'Unknown' WHEN now()-held_at < interval '1 day' THEN '<1 day'
            WHEN now()-held_at < interval '7 days' THEN '1–6 days' WHEN now()-held_at < interval '30 days' THEN '7–29 days' ELSE '30+ days' END AS name,
          count(*)::int AS count FROM normalized GROUP BY 1) b),'[]'::jsonb)`, records)]; break;
    case "audit-log":
      metrics = [total("Total Events"), metric("Today", count("occurred_at >= current_date")), metric("System Events", count("actor_kind = 'system'")), metric("User Actions", count("actor_kind = 'user'"))];
      charts = [trend("Daily activity volume", { unit: "day", periods: 14, series: records }), distribution("Actions by type")]; break;
    case "followups":
      metrics = [metric("Open Manual Tasks", count("state <> 'completed'")), metric("Overdue", count("state <> 'completed' AND due_at < now()")),
        metric("Unacknowledged Automations", raw("(SELECT count(*) FROM broker_follow_ups WHERE status = 'sent' AND acknowledged_at IS NULL)")),
        metric("Email Templates", raw("(SELECT count(*) FROM broker_follow_up_templates)"))];
      charts = [trend("Open vs closed tasks", { kind: "area", series: [{ key: "open", label: "Open", color: orange }, { key: "closed", label: "Closed", color: teal }],
        aggregates: raw("count(n.occurred_at) FILTER (WHERE n.state <> 'completed')::int AS open, count(n.occurred_at) FILTER (WHERE n.state='completed')::int AS closed") }),
        chart("Overdue by age", "cylinder", sql`coalesce((SELECT jsonb_agg(b ORDER BY b.name) FROM (
          SELECT CASE WHEN now()-due_at < interval '7 days' THEN '1–6 days' WHEN now()-due_at < interval '30 days' THEN '7–29 days' ELSE '30+ days' END AS name,
          count(*)::int AS count FROM normalized WHERE due_at < now() AND state <> 'completed' GROUP BY 1) b),'[]'::jsonb)`, records)]; break;
    case "payroll":
      metrics = [money("Current Period Total", "period_end = (SELECT max(period_end) FROM normalized)"),
        metric("Employees", raw("count(DISTINCT employee_key) FILTER (WHERE period_end = (SELECT max(period_end) FROM normalized))")),
        money("Deductions", "period_end = (SELECT max(period_end) FROM normalized)", "deductions")];
      charts = [trend("Payroll by period", { unit: "month", periods: 6 }),
        chart("Payroll deductions", "donut", sql`coalesce((SELECT jsonb_agg(b) FROM (
          SELECT d.deduction_type AS name, sum(d.amount)::float8 AS value FROM payroll_deductions d
          JOIN normalized n ON n.record_id=d.payroll_entry_id::text GROUP BY 1) b),'[]'::jsonb)`, [{ key: "value", label: "Deductions", color: teal, format: "currency" }])]; break;
    case "expenses":
      metrics = [money("Total Expenses"), money("This Month", "occurred_at >= date_trunc('month',now())"), status("Pending Approval", "submitted")];
      charts = [chart("Expenses by category", "donut", sql`coalesce((SELECT jsonb_agg(b ORDER BY b.value DESC) FROM (
        SELECT category AS name, sum(amount)::float8 AS value FROM normalized GROUP BY 1) b),'[]'::jsonb)`, [{ key: "value", label: "Spend", color: teal, format: "currency" }]),
        trend("Monthly spend", { unit: "month", periods: 6 })]; break;
    case "admin":
      if (section === "timetracking") {
        metrics = [total("Time Entries"), metric("Hours Logged", sum("true", "hours"), "hours"), status("Clocked In", "clocked_in")];
        charts = [
          chart("Hours by agent", "cylinder", sql`coalesce((SELECT jsonb_agg(b ORDER BY b.hours DESC) FROM (
            SELECT coalesce(nullif(trim(concat_ws(' ',u.first_name,u.last_name)),''),'Unassigned') AS name,
              sum(n.hours)::float8 AS hours FROM normalized n LEFT JOIN users u ON u.id=n.staff_id GROUP BY 1
            ) b),'[]'::jsonb)`, [{ key: "hours", label: "Hours", color: teal }]),
          trend("Hours by day", { unit: "day", periods: 14, kind: "area",
          series: [{ key: "hours", label: "Hours", color: teal }], aggregates: raw("coalesce(sum(n.hours),0)::float8 AS hours") })];
      } else if (section === "factoring") {
        metrics = [total("Invoices"), status("Under Review", "under_review"), money("Invoice Value")];
        charts = [distribution("Invoice status")];
      } else if (section === "documents") {
        metrics = [total("Document Rules"), status("Active Rules", "active")];
        charts = [distribution("Document rule status")];
      } else if (section === "portal") {
        metrics = [total("Portal Accounts"), status("Active Accounts", "active")];
        charts = [distribution("Portal account status")];
      } else if (section === "audit") {
        metrics = [total("Audit Events"), metric("Events Today", count("occurred_at >= current_date"))];
        charts = [trend("Daily audit activity", { unit: "day", periods: 14, series: records }), distribution("Audit event types")];
      } else {
        metrics = [total("Staff Accounts"), status("Active Staff", "active"), metric("Inactive / Suspended", count("state IN ('inactive','suspended')"))];
        charts = [distribution("Staff account status")];
      }
      break;
    case "vault":
      metrics = [total("Vault Entries"), status("Active Entries", "active"), metric("Added This Month", count("occurred_at >= date_trunc('month',now())"))];
      charts = [distribution("Vault entry status")]; break;
    case "document-rules":
      metrics = [total("Document Rules"), status("Active Rules", "active"), status("Inactive Rules", "inactive")];
      charts = [distribution("Rule status")]; break;
    case "workflow-builder":
      metrics = [total("Workflow Invoices"), metric("Awaiting Review", count("state IN ('submitted','docs_pending','under_review')")), status("Approved", "approved")];
      charts = [distribution("Workflow stages")]; break;
    case "fmcsa-authority":
      metrics = [metric("Active Entities", raw("(SELECT count(*) FROM authority_entities WHERE authority='ACTIVE')")),
        metric("Inactive", raw("(SELECT count(*) FROM authority_entities WHERE authority IN ('INACTIVE','NOT_AUTHORIZED'))")),
        metric("Unknown", raw("(SELECT count(*) FROM authority_entities WHERE authority NOT IN ('ACTIVE','INACTIVE','NOT_AUTHORIZED'))")),
        metric("Last Run", raw("extract(epoch FROM max(occurred_at))*1000"), "datetime")];
      charts = [
        chart("Authority status", "donut", sql`coalesce((SELECT jsonb_agg(b) FROM (
          SELECT CASE WHEN authority='ACTIVE' THEN 'Active' WHEN authority IN ('INACTIVE','NOT_AUTHORIZED') THEN 'Inactive' ELSE 'Unknown' END AS name,
          count(*)::int AS value FROM authority_entities GROUP BY 1) b),'[]'::jsonb)`, [{ key: "value", label: "Entities", color: teal }]),
        trend("Check success rate", { kind: "area", series: [{ key: "rate", label: "Success rate", color: teal, format: "percent" }],
        aggregates: raw("coalesce(100.0 * sum(n.successful) / nullif(sum(n.checked),0),0)::float8 AS rate") })]; break;
  }
  return {
    ctes: entity === "fmcsa-authority" ? authorityInsightCte : sql``,
    metrics: metrics.length ? sql`jsonb_build_array(${sql.join(metrics.map(m => sql`jsonb_build_object(
      'label',${m.label}::text,'value',coalesce((${m.expression})::float8,0),'format',${m.format}::text)`), sql`,`)})` : sql`NULL::jsonb`,
    charts: charts.length ? sql`jsonb_build_array(${sql.join(charts, sql`,`)})` : sql`NULL::jsonb`,
  };
}

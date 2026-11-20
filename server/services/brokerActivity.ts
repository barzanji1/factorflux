import { z } from "zod";
import { pool } from "../db";
import type { BrokerActivityFilters, BrokerNotificationPreferences } from "@shared/broker-activity";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s + "T00:00:00Z"); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}, "Enter a valid calendar date.");
export const activityFilters = z.object({
  brokerId: z.coerce.number().int().positive().max(2147483647).optional(),
  status: z.enum(["all", "pending", "confirmed", "disputed"]).default("all"),
  method: z.enum(["all", "email", "portal"]).default("all"),
  dateFrom: date.optional(), dateTo: date.optional(),
  search: z.string().trim().max(150).default(""),
  timeZone: z.string().max(100).default("UTC").refine(zone => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
  }, "Invalid timezone."),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine(f => !f.dateFrom || !f.dateTo || f.dateFrom <= f.dateTo, "The start date must not be after the end date.");
export type ActivityScope = { userId: string; isTest: boolean };
export const brokerPreferenceInput = z.object({ inApp: z.boolean(), email: z.boolean() }).strict();
export const positiveId = z.coerce.number().int().positive().max(2147483647);
// Only these whitelisted fragments are interpolated. Every filter value is a
// bound parameter. One row per invoice, even after staff corrections/history.
const base = `WITH activity AS (
 SELECT i.id AS invoice_id,i.invoice_number,COALESCE(a.broker_id,i.broker_id) AS broker_id,
 COALESCE(a.broker_name,b.name,'Unknown broker') AS broker_name,COALESCE(a.client_name,c.name,'Unknown client') AS client_name,
 i.amount AS invoice_amount,COALESCE(a.invoice_amount,i.amount) AS action_amount,
 CASE WHEN i.broker_confirmation_status='confirmed' THEN COALESCE(a.approved_amount,i.amount) END AS approved_amount,
 CASE WHEN i.broker_confirmation_status IN ('confirmed','disputed') THEN i.broker_confirmation_status::text ELSE 'pending' END AS status,
 COALESCE(a.sent_at,i.confirmation_sent_at AT TIME ZONE 'UTC') AS sent_at,
 COALESCE(a.acted_at,e.created_at AT TIME ZONE 'UTC',
   CASE WHEN i.broker_confirmation_status='confirmed' THEN i.broker_confirmed_at AT TIME ZONE 'UTC' END) AS acted_at,
 CASE WHEN a.event_id IS NOT NULL THEN a.method
      WHEN e.actor ~ '\\[portal:[0-9]+; broker:[0-9]+\\]$' THEN 'portal'
      WHEN e.id IS NULL OR e.actor LIKE 'agent:%' OR e.actor IN ('system','scheduler') THEN NULL ELSE 'email' END AS method,
 CASE WHEN i.broker_confirmation_status='confirmed' THEN COALESCE(a.historical_amount,true) ELSE false END AS historical_amount,
 COALESCE(i.funded_at,i.submitted_at,i.created_at) AT TIME ZONE 'UTC' AS pending_at
 FROM invoices i LEFT JOIN brokers b ON b.id=i.broker_id LEFT JOIN clients c ON c.id=i.client_id
 LEFT JOIN users owner ON owner.id=i.submitted_by
 LEFT JOIN LATERAL(SELECT * FROM broker_activity_actions x WHERE x.invoice_id=i.id AND x.status=i.broker_confirmation_status::text
   ORDER BY x.event_id DESC LIMIT 1) a ON true
 LEFT JOIN LATERAL(SELECT id,actor,created_at FROM broker_confirmation_events x WHERE x.invoice_id=i.id AND x.event::text=i.broker_confirmation_status::text
   AND x.event IN ('confirmed','disputed') ORDER BY x.id DESC LIMIT 1) e ON a.event_id IS NULL
 WHERE i.broker_id IS NOT NULL AND (i.funded_at IS NOT NULL OR i.confirmation_sent_at IS NOT NULL
   OR i.broker_confirmation_status IN ('confirmed','disputed')) AND COALESCE(owner.is_test_account,false)=$1
), responses AS (
 SELECT *,CASE WHEN acted_at>=sent_at THEN EXTRACT(epoch FROM acted_at-sent_at)::double precision END AS response_seconds
 FROM activity
)`;
function filtered(scope: ActivityScope, input: BrokerActivityFilters, report = false, ignoreStatus = false) {
  const f = activityFilters.parse(input), values: unknown[] = [scope.isTest];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };
  const where: string[] = [report ? "sent_at IS NOT NULL" : "true"];
  if (f.brokerId) where.push(`broker_id=${bind(f.brokerId)}`);
  if (f.status !== "all" && !ignoreStatus) where.push(`status=${bind(f.status)}`);
  if (f.method !== "all") where.push(`method=${bind(f.method)}`);
  if (f.search) {
    const term = bind(`%${f.search.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(invoice_number ILIKE ${term} ESCAPE '\\' OR client_name ILIKE ${term} ESCAPE '\\')`);
  }
  if (f.dateFrom || f.dateTo) {
    const expression = report ? "sent_at" : "COALESCE(acted_at,sent_at,pending_at)";
    const tz = bind(f.timeZone);
    if (f.dateFrom) where.push(`(${expression} AT TIME ZONE ${tz})::date>=${bind(f.dateFrom)}::date`);
    if (f.dateTo) where.push(`(${expression} AT TIME ZONE ${tz})::date<=${bind(f.dateTo)}::date`);
  }
  return { f, values, clause: where.join(" AND ") };
}
const rowColumns = `invoice_id AS "invoiceId",invoice_number AS "invoiceNumber",broker_id AS "brokerId",broker_name AS "brokerName",
 client_name AS "clientName",invoice_amount AS "invoiceAmount",approved_amount AS "approvedAmount",status,
 sent_at AS "sentAt",acted_at AS "actedAt",response_seconds AS "responseSeconds",method,
 (approved_amount IS NOT NULL AND approved_amount<>invoice_amount) AS discrepancy,historical_amount AS "historicalAmount"`;
export async function brokerActivityPage(scope: ActivityScope, input: BrokerActivityFilters) {
  const { f, values, clause } = filtered(scope, input);
  const totals = await pool.query(`${base} SELECT count(*)::int AS total FROM responses WHERE ${clause}`, values);
  const items = await pool.query(`${base} SELECT ${rowColumns} FROM responses WHERE ${clause}
    ORDER BY acted_at DESC NULLS LAST,COALESCE(sent_at,pending_at) DESC,invoice_id DESC LIMIT 15 OFFSET $${values.length + 1}`, [...values, (f.page - 1) * 15]);
  return { items: items.rows, total: totals.rows[0].total, page: f.page, pageSize: 15 };
}
export async function brokerActivityStats(scope: ActivityScope, input: BrokerActivityFilters) {
  const { f, values, clause } = filtered(scope, input, false, true);
  const zone = `$${values.length + 1}`, today = `(acted_at AT TIME ZONE ${zone})::date=(now() AT TIME ZONE ${zone})::date`;
  const result = await pool.query(`${base} SELECT
    count(*) FILTER(WHERE status='pending')::int AS "pendingCount",
    count(*) FILTER(WHERE status='confirmed' AND ${today})::int AS "confirmedTodayCount",
    COALESCE(sum(approved_amount) FILTER(WHERE status='confirmed' AND ${today}),0)::numeric(16,2)::text AS "confirmedTodayAmount",
    count(*) FILTER(WHERE status='disputed' AND ${today})::int AS "disputedTodayCount",
    COALESCE(sum(action_amount) FILTER(WHERE status='disputed' AND ${today}),0)::numeric(16,2)::text AS "disputedTodayAmount",
    avg(response_seconds) FILTER(WHERE method IS NOT NULL) AS "averageResponseSeconds" FROM responses WHERE ${clause}`, [...values, f.timeZone]);
  return { ...result.rows[0], timeZone: f.timeZone };
}
const reportColumns = `broker_id AS "brokerId",COALESCE((SELECT b.name FROM brokers b WHERE b.id=responses.broker_id),max(broker_name)) AS "brokerName",count(*)::int AS "totalSent",
 count(*) FILTER(WHERE status='confirmed')::int AS "confirmedCount",count(*) FILTER(WHERE status='disputed')::int AS "disputedCount",
 count(*) FILTER(WHERE status='pending')::int AS "noResponseCount",avg(response_seconds) FILTER(WHERE method IS NOT NULL) AS "averageResponseSeconds",
 round(100.0*count(*) FILTER(WHERE status='confirmed')/NULLIF(count(*),0),2)::double precision AS "confirmationRate"`;
export async function brokerResponseReport(scope: ActivityScope, input: BrokerActivityFilters) {
  const { f, values, clause } = filtered(scope, input, true, true);
  const total = await pool.query(`${base} SELECT count(DISTINCT broker_id)::int AS total FROM responses WHERE ${clause}`, values);
  const result = await pool.query(`${base} SELECT ${reportColumns} FROM responses WHERE ${clause}
    GROUP BY broker_id ORDER BY "brokerName",broker_id LIMIT 15 OFFSET $${values.length + 1}`, [...values, (f.page - 1) * 15]);
  return { items: result.rows, total: total.rows[0].total, page: f.page, pageSize: 15 };
}
export function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
// Keyset batches export ALL matching brokers, without loading the full result
// into JS memory or silently applying the table's 15-row page limit.
export async function* brokerResponseCsv(scope: ActivityScope, input: BrokerActivityFilters) {
  const { values, clause } = filtered(scope, input, true, true);
  yield "\uFEFF" + ["Broker Name", "Total Invoices Sent", "Confirmed Count", "Disputed Count", "No Response Count", "Average Response Time (seconds)", "Confirmation Rate %"].map(csvCell).join(",") + "\r\n";
  let lastId = 0;
  for (;;) {
    const result = await pool.query(`${base} SELECT ${reportColumns} FROM responses WHERE ${clause} AND broker_id>$${values.length + 1}
      GROUP BY broker_id ORDER BY broker_id LIMIT 500`, [...values, lastId]);
    for (const row of result.rows) {
      yield [row.brokerName, row.totalSent, row.confirmedCount, row.disputedCount, row.noResponseCount, row.averageResponseSeconds, row.confirmationRate].map(csvCell).join(",") + "\r\n";
    }
    if (result.rows.length < 500) return;
    lastId = result.rows.at(-1).brokerId;
  }
}
export async function brokerActivityBrokers(input: unknown) {
  const f = z.object({ search: z.string().trim().max(150).default(""), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(input);
  const search = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`;
  const total = await pool.query("SELECT count(*)::int AS total FROM brokers WHERE name ILIKE $1 ESCAPE '\\'", [search]);
  const rows = await pool.query("SELECT id,name FROM brokers WHERE name ILIKE $1 ESCAPE '\\' ORDER BY name,id LIMIT 50 OFFSET $2", [search, (f.page - 1) * 50]);
  return { brokers: rows.rows, total: total.rows[0].total, page: f.page, pageSize: 50 };
}
export async function brokerNotificationPrefs(userId: string): Promise<BrokerNotificationPreferences> {
  const result = await pool.query('SELECT in_app AS "inApp",email FROM broker_notification_preferences WHERE user_id=$1', [userId]);
  return result.rows[0] || { inApp: true, email: false };
}
export async function updateBrokerNotificationPrefs(userId: string, input: unknown) {
  const f = brokerPreferenceInput.parse(input);
  const result = await pool.query(`INSERT INTO broker_notification_preferences(user_id,in_app,email) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET in_app=EXCLUDED.in_app,email=EXCLUDED.email,updated_at=now() RETURNING in_app AS "inApp",email`, [userId, f.inApp, f.email]);
  return result.rows[0];
}

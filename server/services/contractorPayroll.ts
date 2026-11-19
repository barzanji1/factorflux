import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db";
import { computeContractorTime, payrollGrossCents } from "./contractorPayrollMath";
import { renderPayStatement } from "./contractorPayrollPdf";
import type { ContractorHours, PayPeriod, PayStatement } from "../../shared/contractor-payroll";
import type { PayrollDayBoundary } from "./contractorPayrollMath";

export class PayrollError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface PayrollActor { id: string; role: string; firstName?: string; lastName?: string }
export const reasonSchema = z.string().trim().min(3, "A meaningful reason is required").max(1000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const zoneSchema = z.string().max(80).refine(value => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; } }, "Choose a valid IANA time zone");
const cadenceSchema = z.enum(["weekly", "biweekly", "monthly", "custom"]);
const periodColumns = `id,start_date::text AS "startDate",end_date::text AS "endDate",timezone,cadence,status,
 created_at AS "createdAt",locked_by AS "lockedBy",locked_at AS "lockedAt"`;
const statementColumns = `id,statement_number AS "statementNumber",contractor_id AS "contractorId",contractor_name AS "contractorName",
 period_id AS "periodId",start_date::text AS "startDate",end_date::text AS "endDate",pay_date::text AS "payDate",
 minutes,rate_cents AS "rateCents",gross_cents::float8 AS "grossCents",ytd_gross_cents::float8 AS "ytdGrossCents",
 status,issued_at AS "issuedAt",voided_at AS "voidedAt",void_reason AS "voidReason",replaces_statement_id AS "replacesStatementId"`;
export function assertPayrollAdmin(actor: PayrollActor) {
  if (actor.role !== "admin") throw new PayrollError("Only admins may run payroll.", 403);
}
export async function payrollTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT pg_advisory_xact_lock(710991)");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function audit(client: PoolClient, actor: PayrollActor, action: string, details: unknown) {
  await client.query(`INSERT INTO contractor_payroll_audit(action,actor_id,actor_name,details) VALUES($1,$2,$3,$4::jsonb)`,
    [action, actor.id, [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.id, JSON.stringify(details)]);
}
async function period(client: PoolClient, id: number): Promise<PayPeriod> {
  const result = await client.query(`SELECT ${periodColumns} FROM contractor_payroll_periods WHERE id=$1 FOR UPDATE`, [id]);
  if (!result.rows.length) throw new PayrollError("Pay period not found.", 404);
  return result.rows[0];
}
async function review(client: PoolClient, p: PayPeriod): Promise<ContractorHours[]> {
  const days = await client.query(`SELECT to_char(day,'YYYY-MM-DD') AS date,
    extract(epoch FROM (day::date::timestamp AT TIME ZONE $3))*1000 AS "startMs",
    extract(epoch FROM ((day::date+1)::timestamp AT TIME ZONE $3))*1000 AS "endMs"
    FROM generate_series($1::date,$2::date,interval '1 day') AS day`, [p.startDate, p.endDate, p.timezone]);
  const boundaries: PayrollDayBoundary[] = days.rows.map(day => ({ date: day.date, startMs: Number(day.startMs), endMs: Number(day.endMs) }));
  const entries = await client.query(`SELECT t.id,t.user_id AS "userId",t.clock_in_time AT TIME ZONE 'UTC' AS "clockInTime",
    t.clock_out_time AT TIME ZONE 'UTC' AS "clockOutTime",concat_ws(' ',u.first_name,u.last_name) AS name,r.rate_cents AS "rateCents"
    FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN contractor_payroll_rates r ON r.contractor_id=u.id
      JOIN contractor_payroll_periods p ON p.id=$1
    WHERE t.clock_in_time < p.ends_at AT TIME ZONE 'UTC'
      AND (t.clock_out_time IS NULL OR t.clock_out_time > p.starts_at AT TIME ZONE 'UTC'
        OR (t.clock_out_time<=t.clock_in_time AND t.clock_in_time>=p.starts_at AT TIME ZONE 'UTC'))
    ORDER BY t.user_id,t.clock_in_time,t.id LIMIT 10001`, [p.id]);
  if (entries.rows.length > 10000) throw new PayrollError("Too many time entries; use a shorter period.");
  const approvals = await client.query(`SELECT contractor_id,approved_by,approved_at FROM contractor_payroll_approvals WHERE period_id=$1`, [p.id]);
  const issued = await client.query(`SELECT ${statementColumns} FROM contractor_payroll_statements WHERE period_id=$1 AND status='issued'`, [p.id]);
  const groups = new Map<string, any[]>();
  for (const row of entries.rows) groups.set(row.userId, [...(groups.get(row.userId) || []), row]);
  return [...groups].map(([id, rows]) => {
    const approved = approvals.rows.find(row => row.contractor_id === id);
    return {
      id, name: rows[0].name || id,
      ...computeContractorTime(rows.map(row => ({
        id: row.id, userId: id, clockInTime: new Date(row.clockInTime).toISOString(),
        clockOutTime: row.clockOutTime ? new Date(row.clockOutTime).toISOString() : null,
      })), boundaries),
      approved: !!approved, approvedBy: approved?.approved_by ?? null, approvedAt: approved?.approved_at ?? null,
      rateCents: rows[0].rateCents ?? null, issuedStatement: issued.rows.find(statement => statement.contractorId === id) ?? null,
    };
  });
}
export async function getPayrollReview(id: number) {
  return payrollTransaction(async client => { const p = await period(client, id); return { period: p, contractors: await review(client, p) }; });
}
export async function payrollAdminOverview(contractorPage = 1, periodPage = 1) {
  const [contractors, periods, settings, counts] = await Promise.all([
    pool.query(`SELECT u.id,concat_ws(' ',u.first_name,u.last_name) AS name,r.rate_cents AS "rateCents"
      FROM users u LEFT JOIN contractor_payroll_rates r ON r.contractor_id=u.id
      WHERE u.status IS DISTINCT FROM 'deleted' ORDER BY u.first_name,u.last_name,u.id LIMIT 15 OFFSET $1`, [(contractorPage - 1) * 15]),
    pool.query(`SELECT ${periodColumns} FROM contractor_payroll_periods ORDER BY start_date DESC,id DESC LIMIT 15 OFFSET $1`, [(periodPage - 1) * 15]),
    pool.query(`SELECT cadence,timezone FROM contractor_payroll_settings WHERE id=1`),
    pool.query(`SELECT (SELECT count(*)::int FROM users WHERE status IS DISTINCT FROM 'deleted') AS "contractorTotal",
      (SELECT count(*)::int FROM contractor_payroll_periods) AS "periodTotal"`),
  ]);
  return { contractors: contractors.rows, periods: periods.rows, ...settings.rows[0], ...counts.rows[0], contractorPage, periodPage };
}
export async function listPayStatements(actor: PayrollActor, page: number, year: number) {
  const admin = actor.role === "admin", who = admin ? null : actor.id;
  const [list, count, ytd] = await Promise.all([
    pool.query(`SELECT ${statementColumns} FROM contractor_payroll_statements WHERE ($1::varchar IS NULL OR contractor_id=$1)
      AND extract(year FROM pay_date)=$2 ORDER BY pay_date DESC,id DESC LIMIT 15 OFFSET $3`, [who, year, (page - 1) * 15]),
    pool.query(`SELECT count(*)::int AS total FROM contractor_payroll_statements
      WHERE ($1::varchar IS NULL OR contractor_id=$1) AND extract(year FROM pay_date)=$2`, [who, year]),
    pool.query(`SELECT coalesce(sum(gross_cents),0)::float8 AS total FROM contractor_payroll_statements
      WHERE ($1::varchar IS NULL OR contractor_id=$1) AND status='issued' AND extract(year FROM pay_date)=$2 AND pay_date<=CURRENT_DATE`, [who, year]),
  ]);
  return { isAdmin: admin, statements: list.rows, total: count.rows[0].total, page, ytdGrossCents: ytd.rows[0].total };
}
export async function getPayStatementPdf(actor: PayrollActor, id: number) {
  const result = await pool.query(`SELECT statement_number,pdf_base64,pdf_sha256,status FROM contractor_payroll_statements
    WHERE id=$1 AND ($2::boolean OR contractor_id=$3)`, [id, actor.role === "admin", actor.id]);
  if (!result.rows.length) throw new PayrollError("Pay statement not found.", 404);
  const row = result.rows[0], bytes = Buffer.from(row.pdf_base64, "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== row.pdf_sha256) throw new PayrollError("Stored pay statement failed its integrity check.", 500);
  return { bytes, number: row.statement_number, status: row.status };
}
export async function mutateContractorPayroll(actor: PayrollActor, action: string, id: string, input: unknown) {
  assertPayrollAdmin(actor);
  return payrollTransaction(async client => {
    if (action === "rate") {
      const data = z.object({ rateCents: z.number().int().min(1).max(10000000), reason: reasonSchema }).strict().parse(input);
      const user = await client.query("SELECT id,concat_ws(' ',first_name,last_name) AS name FROM users WHERE id=$1", [id]);
      if (!user.rows.length) throw new PayrollError("Contractor not found.", 404);
      const old = await client.query("SELECT rate_cents FROM contractor_payroll_rates WHERE contractor_id=$1", [id]);
      await client.query(`INSERT INTO contractor_payroll_rates(contractor_id,rate_cents,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(contractor_id) DO UPDATE SET rate_cents=EXCLUDED.rate_cents,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [id, data.rateCents, actor.id]);
      await audit(client, actor, "rate_changed", { contractorId: id, contractorName: user.rows[0].name, oldRateCents: old.rows[0]?.rate_cents ?? null, newRateCents: data.rateCents, reason: data.reason });
      return { ok: true };
    }
    if (action === "settings") {
      const data = z.object({ cadence: cadenceSchema, timezone: zoneSchema }).strict().parse(input);
      const old = await client.query("SELECT cadence,timezone FROM contractor_payroll_settings WHERE id=1");
      await client.query("UPDATE contractor_payroll_settings SET cadence=$1,timezone=$2 WHERE id=1", [data.cadence, data.timezone]);
      await audit(client, actor, "settings_changed", { old: old.rows[0], ...data });
      return { ok: true };
    }
    if (action === "period") {
      const data = z.object({ startDate: dateSchema, endDate: dateSchema, cadence: cadenceSchema, timezone: zoneSchema }).strict().parse(input);
      const dayCount = (Date.parse(data.endDate) - Date.parse(data.startDate)) / 86400000 + 1;
      if (dayCount < 1 || dayCount > 62) throw new PayrollError("A pay period must contain 1–62 calendar days.");
      const overlap = await client.query(`SELECT id FROM contractor_payroll_periods
        WHERE starts_at < (($2::date+1)::timestamp AT TIME ZONE $3) AND ends_at > ($1::date::timestamp AT TIME ZONE $3)`,
      [data.startDate, data.endDate, data.timezone]);
      if (overlap.rows.length) throw new PayrollError("Pay periods cannot overlap.", 409);
      const result = await client.query(`INSERT INTO contractor_payroll_periods(start_date,end_date,timezone,cadence,starts_at,ends_at,created_by)
        VALUES($1,$2,$3,$4,$1::date::timestamp AT TIME ZONE $3,($2::date+1)::timestamp AT TIME ZONE $3,$5) RETURNING ${periodColumns}`,
      [data.startDate, data.endDate, data.timezone, data.cadence, actor.id]);
      await audit(client, actor, "period_created", result.rows[0]);
      return result.rows[0];
    }
    if (action === "time") {
      const data = z.object({ clockInTime: z.string().datetime({ offset: true }), clockOutTime: z.string().datetime({ offset: true }), reason: reasonSchema }).strict().parse(input);
      if (Date.parse(data.clockOutTime) <= Date.parse(data.clockInTime)) throw new PayrollError("Clock-out must follow clock-in.");
      const old = await client.query("SELECT * FROM time_entries WHERE id=$1 FOR UPDATE", [Number(id)]);
      if (!old.rows.length) throw new PayrollError("Time entry not found.", 404);
      await client.query(`UPDATE time_entries SET clock_in_time=$2::timestamptz AT TIME ZONE 'UTC',
        clock_out_time=$3::timestamptz AT TIME ZONE 'UTC',total_hours=round(extract(epoch FROM ($3::timestamptz-$2::timestamptz))/3600,2),
        status='clocked_out',updated_at=now() WHERE id=$1`, [Number(id), data.clockInTime, data.clockOutTime]);
      await audit(client, actor, "time_corrected", { entryId: Number(id), contractorId: old.rows[0].user_id, oldClockIn: old.rows[0].clock_in_time, oldClockOut: old.rows[0].clock_out_time, ...data });
      return { ok: true };
    }
    const p = await period(client, Number(id));
    if (action === "unlock") {
      const { reason } = z.object({ reason: reasonSchema }).strict().parse(input);
      if (p.status !== "locked") throw new PayrollError("Period is not locked.", 409);
      await client.query("UPDATE contractor_payroll_periods SET status='draft',locked_by=NULL,locked_at=NULL WHERE id=$1", [p.id]);
      await client.query("DELETE FROM contractor_payroll_approvals WHERE period_id=$1", [p.id]);
      await audit(client, actor, "period_unlocked", { periodId: p.id, reason, previousLock: { by: p.lockedBy, at: p.lockedAt } });
      return { ok: true };
    }
    if (action === "approve") {
      const { contractorId } = z.object({ contractorId: z.string().min(1).max(255) }).strict().parse(input);
      if (p.status !== "draft") throw new PayrollError("Unlock this period before changing approvals.", 409);
      const person = (await review(client, p)).find(row => row.id === contractorId);
      if (!person || person.flags.length) throw new PayrollError("Resolve all flagged time entries before approving.");
      await client.query(`INSERT INTO contractor_payroll_approvals(period_id,contractor_id,minutes,snapshot,approved_by) VALUES($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT(period_id,contractor_id) DO UPDATE SET minutes=EXCLUDED.minutes,snapshot=EXCLUDED.snapshot,approved_by=EXCLUDED.approved_by,approved_at=now()`,
      [p.id, contractorId, person.minutes, JSON.stringify({ daily: person.daily, entries: person.entries }), actor.id]);
      await audit(client, actor, "hours_approved", { periodId: p.id, contractorId, contractorName: person.name, minutes: person.minutes, daily: person.daily });
      return { ok: true };
    }
    if (action === "lock") {
      z.object({}).strict().parse(input);
      if (p.status !== "draft") throw new PayrollError("Period is already locked.", 409);
      const bounds = await client.query("SELECT ends_at<=now() AS ended FROM contractor_payroll_periods WHERE id=$1", [p.id]);
      if (!bounds.rows[0].ended) throw new PayrollError("A period must end before it can be locked.");
      const people = await review(client, p);
      if (!people.length || people.some(person => !person.approved || person.flags.length)) throw new PayrollError("Every contractor with time in this period must have resolved, approved hours.");
      await client.query("UPDATE contractor_payroll_periods SET status='locked',locked_by=$2,locked_at=now() WHERE id=$1", [p.id, actor.id]);
      await audit(client, actor, "period_approved", { periodId: p.id, contractors: people.map(person => ({ id: person.id, minutes: person.minutes })) });
      await audit(client, actor, "period_locked", { periodId: p.id });
      return { ok: true };
    }
    if (action === "issue") {
      const data = z.object({ contractorId: z.string().min(1).max(255), payDate: dateSchema, replacesStatementId: z.number().int().positive().optional(), reason: reasonSchema.optional() }).strict().parse(input);
      if (p.status !== "locked") throw new PayrollError("Approve and lock the period before issuing a statement.");
      const approval = await client.query("SELECT * FROM contractor_payroll_approvals WHERE period_id=$1 AND contractor_id=$2", [p.id, data.contractorId]);
      if (!approval.rows.length) throw new PayrollError("This contractor's hours have not been approved.");
      const [rate, user, existing] = await Promise.all([
        client.query("SELECT rate_cents FROM contractor_payroll_rates WHERE contractor_id=$1", [data.contractorId]),
        client.query("SELECT concat_ws(' ',first_name,last_name) AS name FROM users WHERE id=$1", [data.contractorId]),
        client.query("SELECT id FROM contractor_payroll_statements WHERE period_id=$1 AND contractor_id=$2 AND status='issued'", [p.id, data.contractorId]),
      ]);
      if (!rate.rows.length) throw new PayrollError("Set this contractor's hourly rate first.");
      if (existing.rows.length) {
        if (data.replacesStatementId !== existing.rows[0].id || !data.reason) throw new PayrollError("A statement already exists. Use void/reissue with a reason.", 409);
        await client.query("UPDATE contractor_payroll_statements SET status='void',voided_by=$2,voided_at=now(),void_reason=$3 WHERE id=$1", [data.replacesStatementId, actor.id, data.reason]);
        await audit(client, actor, "statement_voided", { statementId: data.replacesStatementId, reason: data.reason });
      } else if (data.replacesStatementId) throw new PayrollError("The statement selected for replacement is no longer active.", 409);
      const sequence = await client.query("SELECT nextval(pg_get_serial_sequence('contractor_payroll_statements','id'))::int AS id");
      const statementId = sequence.rows[0].id, approved = approval.rows[0];
      const gross = payrollGrossCents(approved.minutes, rate.rows[0].rate_cents);
      const ytd = await client.query(`SELECT coalesce(sum(gross_cents),0)::float8 AS total FROM contractor_payroll_statements
        WHERE contractor_id=$1 AND status='issued' AND pay_date>=date_trunc('year',$2::date)::date AND pay_date<=$2::date`, [data.contractorId, data.payDate]);
      const statement: PayStatement = {
        id: statementId, statementNumber: `PS-${data.payDate.slice(0, 4)}-${String(statementId).padStart(7, "0")}`, periodId: p.id,
        contractorId: data.contractorId, contractorName: user.rows[0]?.name || data.contractorId, startDate: p.startDate, endDate: p.endDate,
        payDate: data.payDate, minutes: approved.minutes, rateCents: rate.rows[0].rate_cents, grossCents: gross, ytdGrossCents: Number(ytd.rows[0].total) + gross,
        status: "issued", issuedAt: new Date().toISOString(), voidedAt: null, voidReason: null, replacesStatementId: data.replacesStatementId ?? null,
      };
      const pdf = await renderPayStatement(statement, approved.snapshot.daily, p.timezone);
      await client.query(`INSERT INTO contractor_payroll_statements(id,statement_number,period_id,contractor_id,contractor_name,start_date,end_date,pay_date,
        minutes,rate_cents,gross_cents,ytd_gross_cents,snapshot,pdf_base64,pdf_sha256,issued_by,replaces_statement_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)`,
      [statementId, statement.statementNumber, p.id, statement.contractorId, statement.contractorName, p.startDate, p.endDate, statement.payDate,
        statement.minutes, statement.rateCents, gross, statement.ytdGrossCents, JSON.stringify(approved.snapshot), pdf.toString("base64"),
        createHash("sha256").update(pdf).digest("hex"), actor.id, statement.replacesStatementId]);
      await audit(client, actor, data.replacesStatementId ? "statement_reissued" : "statement_generated", { statementId, statementNumber: statement.statementNumber, contractorId: data.contractorId, contractorName: statement.contractorName, periodId: p.id, minutes: statement.minutes, rateCents: statement.rateCents, grossCents: gross, replacesStatementId: statement.replacesStatementId, reason: data.reason });
      return statement;
    }
    throw new PayrollError("Unsupported payroll operation.");
  });
}

import { and, asc, desc, getTableColumns, sql, type SQL } from "drizzle-orm";
import { tasks, invoices, clients, brokers, followUps } from "@shared/schema";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { z } from "zod";
import { db } from "../db";

const filters = z.object({
  page: z.coerce.number().int().positive().max(100000).default(1),
  limit: z.coerce.number().int().positive().max(200).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(300).optional(), status: z.string().max(40).optional(),
  priority: z.string().max(40).optional(), type: z.string().max(40).optional(), category: z.string().max(40).optional(),
  assignee: z.string().max(200).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(["due", "priority", "status"]).default("due"),
});
const rank = sql`CASE ${tasks.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;
export function taskPageOptions(input: unknown, visibility?: SQL) {
  const f = filters.parse(input);
  const conditions: Array<SQL | undefined> = [visibility];
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`concat_ws(' ', ${tasks.title}, ${tasks.description}, ${invoices.invoiceNumber},
      ${tasks.confirmationInvoiceId}, ${clients.name}, ${brokers.name}) ILIKE ${term}`);
  }
  if (f.category === "chargebacks") conditions.push(sql`${tasks.type} = 'chargeback'`);
  if (f.category === "followups") conditions.push(sql`${tasks.type} = 'followup'`);
  if (f.category === "held") conditions.push(sql`${tasks.status} = 'held'`);
  if (f.category === "working") conditions.push(sql`${tasks.status} = 'in_progress'`);
  if (f.category === "calls") conditions.push(sql`${tasks.type} = 'call' AND ${tasks.status} <> 'completed'`);
  if (f.category === "manual") conditions.push(sql`${tasks.type} IN ('task','processing')`);
  if (f.type && f.type !== "all") conditions.push(sql`${tasks.type} IN (${sql.join(f.type.split(",").map(type => sql`${type}`), sql`,`)})`);
  if (f.status === "open") conditions.push(sql`${tasks.status} <> 'completed'`);
  else if (f.status === "overdue") conditions.push(sql`${tasks.status} <> 'completed' AND ${tasks.dueDate}::date < ${f.today ? sql`${f.today}::date` : sql`current_date`}`);
  else if (f.status && f.status !== "all") conditions.push(sql`${tasks.status} = ${f.status}`);
  if (f.priority && f.priority !== "all") conditions.push(sql`${tasks.priority} = ${f.priority}`);
  if (f.assignee === "__unassigned" || f.assignee === "unassigned") conditions.push(sql`${tasks.assignedTo} IS NULL`);
  else if (f.assignee && f.assignee !== "all") conditions.push(sql`${tasks.assignedTo} = ${f.assignee}`);
  if (f.from) {
    const date = new Date(f.from); if (!Number.isFinite(date.getTime())) throw new Error("Invalid task date");
    conditions.push(sql`${tasks.createdAt} >= ${date}`);
  }
  if (f.to) {
    const date = new Date(f.to); if (!Number.isFinite(date.getTime())) throw new Error("Invalid task date");
    conditions.push(sql`${tasks.createdAt} <= ${date}`);
  }
  const order = f.sort === "priority" ? [asc(rank), asc(tasks.createdAt), asc(tasks.id)]
    : f.sort === "status" ? [asc(tasks.status), asc(rank), asc(tasks.id)]
    : [sql`coalesce(${tasks.dueDate}::date, '9999-12-31'::date) ASC`, asc(rank), asc(tasks.id)];
  return { ...f, where: and(...conditions), order, offset: (f.page - 1) * f.limit };
}

export async function followUpPage(input: unknown) {
  const f = filters.extend({ clientId: z.coerce.number().int().positive().optional() }).parse(input);
  const conditions: SQL[] = [];
  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`concat_ws(' ', ${followUps.title}, ${followUps.description}) ILIKE ${term}`);
  }
  if (f.status && f.status !== "all") conditions.push(sql`${followUps.status} = ${f.status}`);
  if (f.priority && f.priority !== "all") conditions.push(sql`${followUps.priority} = ${f.priority}`);
  if (f.clientId) conditions.push(sql`${followUps.clientId} = ${f.clientId}`);
  const where = and(...conditions);
  const [[total], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(followUps).where(where),
    db.select({ ...getTableColumns(followUps), client: { id: clients.id, name: clients.name, email: clients.email } })
      .from(followUps).leftJoin(clients, sql`${followUps.clientId} = ${clients.id}`).where(where)
      .orderBy(desc(followUps.createdAt), desc(followUps.id)).limit(f.limit).offset((f.page - 1) * f.limit),
  ]);
  return { total: total.count, rows, limit: f.limit };
}

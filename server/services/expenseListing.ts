import { and, count, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { expenses, users } from "@shared/schema";
import { getSignedViewUrl } from "./s3Service";

/** Bounded table reads, full-scope summaries, and no per-row user lookups. */
export async function listExpenses(
  conditions: SQL[], page: number, pageSize: number, all = false,
  database: Pick<typeof db, "select" | "selectDistinct"> = db,
) {
  const where = conditions.length ? and(...conditions) : undefined;
  const base = database.select({
    ...getTableColumns(expenses),
    firstName: users.firstName, lastName: users.lastName, email: users.email,
  }).from(expenses).leftJoin(users, eq(expenses.submittedBy, users.id))
    .where(where).orderBy(desc(expenses.expenseDate), desc(expenses.createdAt), desc(expenses.id)).$dynamic();
  const rowsQuery = all ? base : base.limit(pageSize).offset((page - 1) * pageSize);
  const [rows, [summary], agentRows] = await Promise.all([
    rowsQuery,
    database.select({
      total: count(),
      monthCents: sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.expenseDate} >= date_trunc('month', now()) and ${expenses.expenseDate} < date_trunc('month', now()) + interval '1 month'), 0)`,
      pending: sql<number>`count(*) filter (where ${expenses.status} = 'submitted')::int`,
      approvedCents: sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.status} = 'approved'), 0)`,
      reimbursedCents: sql<string>`coalesce(sum(${expenses.amountCents}) filter (where ${expenses.status} = 'reimbursed'), 0)`,
    }).from(expenses).where(where),
    database.selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(expenses).innerJoin(users, eq(expenses.submittedBy, users.id)).where(where),
  ]);
  const items = await Promise.all(rows.map(async ({ firstName, lastName, email, receiptKey, ...expense }) => ({
    ...expense,
    amount: (Number(expense.amountCents) / 100).toFixed(2),
    submittedByName: [firstName, lastName].filter(Boolean).join(" ") || email || "Unknown agent",
    receiptUrl: receiptKey ? await getSignedViewUrl(receiptKey) : null,
  })));
  if (all) return items;
  return {
    items, total: summary.total, page, pageSize,
    summary: {
      monthTotal: Number(summary.monthCents) / 100, pending: summary.pending,
      approvedTotal: Number(summary.approvedCents) / 100, reimbursedTotal: Number(summary.reimbursedCents) / 100,
    },
    agents: agentRows.map(({ id, firstName, lastName, email }) => ({
      id, name: [firstName, lastName].filter(Boolean).join(" ") || email || "Unknown agent",
    })),
  };
}

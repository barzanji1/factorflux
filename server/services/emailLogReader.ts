import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { emailLog, emailLogEvents, emailRetryPayloads, users } from "../../shared/schema";
import { db } from "../db";
import { EmailLogError, retryDisabledReason, type EmailStore } from "./emailLogService";
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const date = new Date(`${s}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
});
export const emailLogFilters = z.object({
  from: day.optional(), to: day.optional(),
  entityType: z.enum(["invoice", "carrier", "broker", "chargeback", "followup"]).optional(),
  status: z.enum(["sent", "delivered", "bounced", "complained", "failed"]).optional(),
  agentId: z.string().max(200).optional(), q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine(v => !v.from || !v.to || v.from <= v.to, "End date must be on or after start date");
const entityPaths = { invoice: "/invoices/", carrier: "/clients/", broker: "/brokers/" };
function entityUrl(type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type in entityPaths) return entityPaths[type as keyof typeof entityPaths] + encodeURIComponent(id);
  return `/follow-up?${type}Id=${encodeURIComponent(id)}`;
}
// Select retry eligibility only, never the encrypted body or idempotency key.
const selection = {
  row: emailLog, sentByName: sql<string | null>`nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), '')`,
  retry: {
    state: emailRetryPayloads.state, uncertain: emailRetryPayloads.uncertain,
    lockUntil: emailRetryPayloads.lockUntil, createdAt: emailRetryPayloads.createdAt, resolvedById: emailRetryPayloads.resolvedById,
    hasPayload: sql<boolean>`${emailRetryPayloads.encryptedPayload} IS NOT NULL`,
  },
};
type Selected = { row: typeof emailLog.$inferSelect; sentByName: string | null; retry: {
  state: "sending" | "failed" | "accepted" | null; uncertain: boolean | null; lockUntil: Date | null;
  createdAt: Date | null; resolvedById: number | null; hasPayload: boolean;
} | null };
function serialize(value: Selected, manager: boolean) {
  const { row, retry, sentByName } = value;
  const reason = retryDisabledReason(row.status, retry?.state && retry.createdAt ? {
    ...retry, state: retry.state, uncertain: retry.uncertain ?? true, createdAt: retry.createdAt,
    encryptedPayload: retry.hasPayload ? "available" : null,
  } : undefined);
  return { ...row, sentByName: row.sentByUserId ? sentByName || "Former staff member" : "System",
    entityUrl: entityUrl(row.entityType, row.entityId), canResend: manager && !reason, resendDisabledReason: reason,
    inProgress: retry?.state === "sending" && !!retry.lockUntil && retry.lockUntil > new Date() };
}
export async function listEmailLog(input: unknown, manager: boolean, store: EmailStore = db) {
  const filter = emailLogFilters.parse(input);
  const term = filter.q ? `%${filter.q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  const where = and(
    filter.from ? sql`${emailLog.createdAt} >= ((${filter.from}::date)::timestamp AT TIME ZONE 'America/Denver') AT TIME ZONE 'UTC'` : undefined,
    filter.to ? sql`${emailLog.createdAt} < ((${filter.to}::date + interval '1 day') AT TIME ZONE 'America/Denver') AT TIME ZONE 'UTC'` : undefined,
    filter.entityType ? eq(emailLog.entityType, filter.entityType) : undefined,
    filter.status ? eq(emailLog.status, filter.status) : undefined,
    filter.agentId ? filter.agentId === "system" ? sql`${emailLog.sentByUserId} IS NULL` : eq(emailLog.sentByUserId, filter.agentId) : undefined,
    term ? or(ilike(emailLog.subject, term), sql`array_to_string(${emailLog.toAddresses} || ${emailLog.ccAddresses}, ' ') ILIKE ${term}`) : undefined,
  );
  const [count] = await store.select({ total: sql<string>`count(*)` }).from(emailLog).where(where);
  const rows = await store.select(selection).from(emailLog).leftJoin(users, eq(users.id, emailLog.sentByUserId))
    .leftJoin(emailRetryPayloads, eq(emailRetryPayloads.emailLogId, emailLog.id)).where(where)
    .orderBy(desc(emailLog.createdAt), desc(emailLog.id)).limit(filter.pageSize).offset((filter.page - 1) * filter.pageSize);
  return { rows: rows.map(row => serialize(row, manager)), total: Number(count.total), page: filter.page, pageSize: filter.pageSize };
}
export async function readEmailLog(id: number, manager: boolean, store: EmailStore = db) {
  const [row] = await store.select(selection).from(emailLog).leftJoin(users, eq(users.id, emailLog.sentByUserId))
    .leftJoin(emailRetryPayloads, eq(emailRetryPayloads.emailLogId, emailLog.id)).where(eq(emailLog.id, id));
  if (!row) throw new EmailLogError(404, "Email not found");
  const events = await store.select({ id: emailLogEvents.id, type: emailLogEvents.type, status: emailLogEvents.status,
    occurredAt: emailLogEvents.occurredAt, notes: emailLogEvents.notes }).from(emailLogEvents)
    .where(or(eq(emailLogEvents.emailLogId, id), row.row.resendMessageId ? eq(emailLogEvents.resendMessageId, row.row.resendMessageId) : undefined))
    .orderBy(desc(emailLogEvents.occurredAt), desc(emailLogEvents.id));
  return { ...serialize(row, manager), events };
}

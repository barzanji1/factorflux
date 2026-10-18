import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users, itSupportRequests as requests, itSupportResponses as responses, itSupportNotifications as alerts } from "@shared/schema";

type Database = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
export class ItSupportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const supportCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(20000),
  type: z.enum(["bug", "feature_idea", "question"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
}).strict();
export const supportUpdateSchema = z.object({
  status: z.enum(["submitted", "in_progress", "resolved"]).optional(),
  response: z.string().trim().max(10000).optional(),
}).strict();
// Stable account identity: email/profile edits must never reroute IT requests.
export const IT_CONTACT_USER_ID = "admin-1";
const staffRoles = ["employee", "manager", "admin"];
// Serialize request changes and per-recipient acknowledgements.
export async function supportLock(database: Database) {
  await database.execute(sql`SELECT pg_advisory_xact_lock(746281903)`);
}
async function actor(database: Database, userId: string) {
  const [person] = await database.select().from(users).where(eq(users.id, userId));
  if (!person || person.status !== "active" || !staffRoles.includes(person.role)) {
    throw new ItSupportError(403, "Active staff access required");
  }
  return person;
}
const name = (person: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email || "Staff member";
async function contact(database: Database) {
  const [person] = await database.select().from(users).where(and(eq(users.id, IT_CONTACT_USER_ID), eq(users.status, "active"), eq(users.isTestAccount, false)));
  return person && staffRoles.includes(person.role) ? person : null;
}
async function context(database: Database, userId: string) {
  const person = await actor(database, userId);
  const handler = await contact(database);
  return { person, handler, isContact: handler?.id === person.id };
}
export async function supportMeta(database: Database, userId: string) {
  const { handler, isContact } = await context(database, userId);
  return {
    contact: handler ? { id: handler.id, name: name(handler) } : null,
    isContact,
  };
}
const requestSelection = {
  id: requests.id, title: requests.title, description: requests.description,
  type: requests.type, priority: requests.priority, status: requests.status,
  submittedByAgentId: requests.submittedByAgentId,
  submittedByName: sql<string>`coalesce(nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), ''), ${users.email}, 'Staff member')`,
  createdAt: requests.createdAt, updatedAt: requests.updatedAt, resolvedAt: requests.resolvedAt,
};
async function requestRow(database: Database, id: number) {
  const [row] = await database.select(requestSelection).from(requests).innerJoin(users, eq(users.id, requests.submittedByAgentId)).where(eq(requests.id, id));
  if (!row) throw new ItSupportError(404, "Request not found");
  return row;
}
export async function supportList(database: Database, userId: string, scope: "mine" | "triage") {
  const ctx = await context(database, userId);
  if (scope === "triage" && !ctx.isContact) throw new ItSupportError(403, "Only the designated IT contact can view triage");
  return database.select(requestSelection).from(requests).innerJoin(users, eq(users.id, requests.submittedByAgentId))
    .where(scope === "mine" ? eq(requests.submittedByAgentId, userId) : undefined).orderBy(desc(requests.updatedAt), desc(requests.id));
}
export async function createSupportRequest(database: Database, userId: string, raw: unknown) {
  const input = supportCreateSchema.parse(raw);
  await supportLock(database);
  const ctx = await context(database, userId);
  if (!ctx.handler) throw new ItSupportError(503, "Dosh's IT support account is unavailable. Please retry later.");
  const [request] = await database.insert(requests).values({ ...input, submittedByAgentId: userId }).returning();
  {
    await database.insert(alerts).values({ requestId: request.id, userId: ctx.handler.id, type: "it_request_submitted" });
  }
  return requestRow(database, request.id);
}
export async function supportDetail(database: Database, userId: string, id: number) {
  await supportLock(database);
  const ctx = await context(database, userId);
  const request = await requestRow(database, id);
  if (!ctx.isContact && request.submittedByAgentId !== userId) throw new ItSupportError(404, "Request not found");
  await database.update(alerts).set({ read: true }).where(and(eq(alerts.requestId, id), eq(alerts.userId, userId), eq(alerts.read, false)));
  const discussion = await database.select({
    id: responses.id, body: responses.body, createdAt: responses.createdAt,
    authorName: sql<string>`coalesce(nullif(trim(concat_ws(' ', ${users.firstName}, ${users.lastName})), ''), ${users.email}, 'Staff member')`,
  }).from(responses).innerJoin(users, eq(users.id, responses.authorId)).where(eq(responses.requestId, id)).orderBy(responses.createdAt, responses.id);
  return { request, responses: discussion, canManage: ctx.isContact };
}
export async function updateSupportRequest(database: Database, userId: string, id: number, raw: unknown) {
  const input = supportUpdateSchema.parse(raw);
  await supportLock(database);
  const ctx = await context(database, userId);
  if (!ctx.isContact) throw new ItSupportError(403, "Only the designated IT contact can update requests");
  const current = await requestRow(database, id);
  const changed = input.status !== undefined && input.status !== current.status;
  if (!changed && !input.response) return current;
  if (changed) {
    await database.insert(responses).values({ requestId: id, authorId: userId,
      body: `Status changed: ${current.status.replaceAll("_", " ")} → ${input.status!.replaceAll("_", " ")}` });
  }
  if (input.response) await database.insert(responses).values({ requestId: id, authorId: userId, body: input.response });
  await database.update(requests).set({ updatedAt: new Date(), ...(changed ? {
    status: input.status, resolvedAt: input.status === "resolved" ? new Date() : null,
  } : {}) }).where(eq(requests.id, id));
  if (current.submittedByAgentId !== userId) {
    await database.insert(alerts).values({ requestId: id, userId: current.submittedByAgentId, type: "it_request_updated" });
  }
  return requestRow(database, id);
}
export async function deleteSupportRequest(database: Database, userId: string, id: number, raw: unknown) {
  z.object({ confirm: z.literal(true) }).strict().parse(raw);
  await supportLock(database);
  const ctx = await context(database, userId);
  if (!ctx.isContact) throw new ItSupportError(403, "Only the designated IT contact can delete requests");
  const request = await requestRow(database, id);
  if (request.status !== "resolved") throw new ItSupportError(409, "Only resolved requests can be deleted");
  // Database foreign keys cascade both responses and every recipient's alerts atomically.
  await database.delete(requests).where(eq(requests.id, id));
  return { deleted: true };
}
export async function supportUnread(database: Database, userId: string) {
  const ctx = await context(database, userId);
  const type = ctx.isContact ? "it_request_submitted" : "it_request_updated";
  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.type, type), eq(alerts.read, false)));
  return { count: row.count, mode: ctx.isContact ? "triage" as const : "updates" as const };
}

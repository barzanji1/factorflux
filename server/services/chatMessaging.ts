import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  chatChannels, chatMembers, chatMessages, notifications, users, userPermissions,
  ROLE_DEFAULT_PERMISSIONS, type ChatMention,
} from "@shared/schema";
import { createHash } from "node:crypto";

type Database = Pick<typeof db, "select" | "insert" | "update">;
export const chatPostSchema = z.object({
  body: z.string().trim().min(1, "Message body is required").max(10000),
  parentMessageId: z.number().int().positive().optional(),
}).strict();

export class ChatMessageError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

type StaffRecord = {
  id: string; firstName: string | null; lastName: string | null; email: string | null;
  role: string; status: string | null; isTestAccount: boolean;
};
export type MentionStaff = { id: string; name: string; email: string | null; role: string; handle: string };

export function isRealActiveStaff(person: StaffRecord) {
  if (person.status !== "active" || person.isTestAccount ||
      !["admin", "manager", "employee"].includes(person.role)) return false;
  if (!person.firstName && !person.lastName && !person.email) return false;
  const synthetic = /(?:^|[\s._+-])(test(?:\d+)?|fixture|demo|dummy|mock|seed)(?:$|[\s._+-])/i;
  const identity = [person.id, person.firstName, person.lastName, person.email?.split("@")[0]];
  if (identity.some(value => value && synthetic.test(value))) return false;
  return !person.email || !/@(?:example\.(?:com|org|net)|[^@]+\.(?:invalid|test))$/i.test(person.email);
}

const handlePart = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

export function staffWithHandles(people: StaffRecord[]): MentionStaff[] {
  const eligible = people.filter(isRealActiveStaff).sort((a, b) => a.id.localeCompare(b.id));
  const bases = eligible.map(person => handlePart(person.firstName || person.email?.split("@")[0] || person.lastName || "staff") || "staff");
  const frequencies = new Map<string, number>();
  for (const base of bases) frequencies.set(base, (frequencies.get(base) || 0) + 1);
  // Hash-suffixed handles are deliberately reserved for duplicate first names:
  // they stay unambiguous even when surname tokens overlap another staff name.
  return eligible.map((person, index) => ({
    id: person.id,
    name: [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email?.split("@")[0] || "Staff",
    email: person.email, role: person.role,
    handle: frequencies.get(bases[index]) === 1
      ? bases[index]
      : `${bases[index]}.${createHash("sha256").update(person.id).digest("hex")}`,
  }));
}

export async function assertChatMembership(database: Database, channelId: number, userId: string) {
  const [member] = await database.select({ userId: chatMembers.userId }).from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));
  if (!member) throw new ChatMessageError(403, "Chat channel access required");
}

export async function getMentionStaff(database: Database = db, channelId?: number) {
  const rows = await database.select({
    id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email,
    role: users.role, status: users.status, isTestAccount: users.isTestAccount,
  }).from(users).where(eq(users.status, "active"));
  const permissions = await database.select({
    userId: userPermissions.userId, permission: userPermissions.permission, granted: userPermissions.granted,
  }).from(userPermissions);
  const overrides = new Map<string, typeof permissions>();
  for (const row of permissions) overrides.set(row.userId, [...(overrides.get(row.userId) || []), row]);
  let staff = staffWithHandles(rows.filter(person => person.role === "admin" ||
    (overrides.has(person.id)
      ? overrides.get(person.id)!.some(row => row.permission === "chat" && row.granted)
      : (ROLE_DEFAULT_PERMISSIONS[person.role] || []).includes("chat"))));
  if (channelId !== undefined) {
    const [channel] = await database.select({ type: chatChannels.type }).from(chatChannels).where(eq(chatChannels.id, channelId));
    if (!channel) throw new ChatMessageError(404, "Conversation not found");
    if (channel.type === "direct") {
      const members = await database.select({ userId: chatMembers.userId }).from(chatMembers).where(eq(chatMembers.channelId, channelId));
      const ids = new Set(members.map(member => member.userId));
      staff = staff.filter(person => ids.has(person.id));
    }
  }
  return staff;
}

export function resolveMentions(body: string, staff: MentionStaff[]): ChatMention[] {
  const directory = new Map(staff.map(person => [person.handle.toLowerCase(), person]));
  const mentions: ChatMention[] = [];
  for (const match of body.matchAll(/@([a-z0-9]+(?:[._-][a-z0-9]+)*)/gi)) {
    const start = match.index!;
    if (start > 0 && /[\p{L}\p{N}_@]/u.test(body[start - 1])) continue; // Not email addresses.
    const person = directory.get(match[1].toLowerCase());
    if (person) mentions.push({ userId: person.id, handle: person.handle, start, end: start + match[0].length });
  }
  return mentions;
}

export const chatMessageSelection = {
  id: chatMessages.id, channelId: chatMessages.channelId, senderId: chatMessages.senderId,
  body: chatMessages.body, createdAt: chatMessages.createdAt, editedAt: chatMessages.editedAt,
  parentMessageId: chatMessages.parentMessageId, mentions: chatMessages.mentions,
  senderName: sql<string>`coalesce(nullif(trim(concat(coalesce(${users.firstName}, ''), ' ', coalesce(${users.lastName}, ''))), ''), 'Staff')`,
  replyCount: sql<number>`(SELECT count(*)::int FROM chat_messages reply
    WHERE reply.channel_id = ${chatMessages.channelId} AND reply.parent_message_id = ${chatMessages.id})`,
};

// Must run inside the caller's transaction: message, bell alerts and read cursor
// succeed together, or none of them are committed.
export async function createChatMessage(
  database: Database, channelId: number, senderId: string, raw: unknown,
) {
  const input = chatPostSchema.parse(raw);
  await assertChatMembership(database, channelId, senderId);
  let rootId: number | null = null;
  if (input.parentMessageId !== undefined) {
    const [parent] = await database.select({
      id: chatMessages.id, parentMessageId: chatMessages.parentMessageId, channelId: chatMessages.channelId,
    }).from(chatMessages).where(eq(chatMessages.id, input.parentMessageId));
    if (!parent || parent.channelId !== channelId) throw new ChatMessageError(404, "Parent message not found in this conversation");
    rootId = parent.parentMessageId ?? parent.id;
    const [root] = await database.select({ id: chatMessages.id }).from(chatMessages)
      .where(and(eq(chatMessages.id, rootId), eq(chatMessages.channelId, channelId), isNull(chatMessages.parentMessageId)));
    if (!root) throw new ChatMessageError(404, "Thread parent no longer exists");
  }
  const staff = await getMentionStaff(database, channelId);
  const mentions = resolveMentions(input.body, staff);
  const [message] = await database.insert(chatMessages).values({
    channelId, senderId, body: input.body, parentMessageId: rootId, mentions,
  }).returning();
  const recipients = [...new Set(mentions.map(mention => mention.userId))].filter(id => id !== senderId);
  if (recipients.length) {
    const [sender] = await database.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, senderId));
    const [channel] = await database.select({ name: chatChannels.name, type: chatChannels.type }).from(chatChannels).where(eq(chatChannels.id, channelId));
    const senderName = [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") || "A teammate";
    const context = channel?.type === "direct" ? "a direct conversation" : `#${channel?.name || "chat"}`;
    await database.insert(notifications).values(recipients.map(userId => ({
      userId, title: `${senderName} @mentioned you in ${context}`,
      message: `${senderName}: ${input.body.slice(0, 240)}`,
      type: "warning" as const, entityType: "chat_mention", entityId: message.id,
      actionUrl: `/chat?channelId=${channelId}${rootId ? `&threadId=${rootId}` : ""}&messageId=${message.id}`,
      metadata: JSON.stringify({ channelId, messageId: message.id, threadId: rootId }),
    })));
  }
  await database.update(chatMembers).set({ lastReadAt: new Date() })
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, senderId)));
  return message;
}

export async function getChatThread(database: Database, channelId: number, rootId: number, userId: string, afterId = 0) {
  await assertChatMembership(database, channelId, userId);
  const [parent] = await database.select(chatMessageSelection).from(chatMessages).innerJoin(users, eq(users.id, chatMessages.senderId))
    .where(and(eq(chatMessages.id, rootId), eq(chatMessages.channelId, channelId), isNull(chatMessages.parentMessageId)));
  if (!parent) throw new ChatMessageError(404, "Thread not found in this conversation");
  const page = await database.select(chatMessageSelection).from(chatMessages).innerJoin(users, eq(users.id, chatMessages.senderId))
    .where(and(eq(chatMessages.channelId, channelId), eq(chatMessages.parentMessageId, rootId), gt(chatMessages.id, afterId)))
    .orderBy(asc(chatMessages.id)).limit(101);
  const replies = page.slice(0, 100);
  return { parent, replies, hasMore: page.length > 100, nextCursor: replies.at(-1)?.id ?? afterId };
}

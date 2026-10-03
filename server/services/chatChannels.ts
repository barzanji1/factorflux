import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { chatChannels, chatMembers, chatMessages } from "@shared/schema";

export const DEFAULT_CHAT_CHANNELS = ["general", "operations"] as const;
export const normalizeChatChannelName = (name: string) =>
  name.trim().replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, "-");

export const createChatChannelSchema = z.object({
  name: z.string().max(100, "Channel name is too long")
    .transform(normalizeChatChannelName)
    .pipe(z.string().min(1, "Enter a channel name").max(50, "Use 50 characters or fewer")
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores")),
}).strict();

export class ChatChannelNameConflict extends Error {
  constructor() { super("A channel with that name already exists."); }
}

// All app-created public names share this transaction lock, including defaults.
const lockPublicChannels = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('team-chat:public-channel-names'))`);
};

export async function ensureDefaultChatChannels(database = db) {
  await database.transaction(async tx => {
    await lockPublicChannels(tx);
    const existing = await tx.select({ name: chatChannels.name }).from(chatChannels)
      .where(eq(chatChannels.type, "channel"));
    const names = new Set(existing.map(channel => normalizeChatChannelName(channel.name ?? "")));
    const missing = DEFAULT_CHAT_CHANNELS.filter(name => !names.has(name));
    if (missing.length) {
      await tx.insert(chatChannels).values(missing.map(name => ({ name, type: "channel" as const })));
    }
  });
}

export async function createPublicChatChannel(rawName: string, userId: string, database = db) {
  const { name } = createChatChannelSchema.parse({ name: rawName });
  return database.transaction(async tx => {
    await lockPublicChannels(tx);
    const existing = await tx.select({ name: chatChannels.name }).from(chatChannels)
      .where(eq(chatChannels.type, "channel"));
    if (existing.some(channel => normalizeChatChannelName(channel.name ?? "") === name)) {
      throw new ChatChannelNameConflict();
    }
    const [channel] = await tx.insert(chatChannels).values({ name, type: "channel" }).returning();
    // Creator can send immediately; everyone else joins through the same public-list
    // membership flow already used for the default channels.
    await tx.insert(chatMembers).values({ channelId: channel.id, userId }).onConflictDoNothing();
    return { ...channel, unreadCount: 0, members: [], directName: null };
  });
}

/**
 * One-time, explicitly approved maintenance only. Never run on startup/poll:
 * a later custom channel may legitimately reuse either name.
 * Any channel with even one message is retained for the user's decision.
 */
export async function retireEmptyLegacyChatChannels(database = db) {
  return database.transaction(async tx => {
    await lockPublicChannels(tx);
    // Parent FOR UPDATE locks block concurrent FK message inserts until the
    // fresh count/delete decision completes; committed history cannot be lost.
    const channels = await tx.select().from(chatChannels)
      .where(and(eq(chatChannels.type, "channel"),
        sql`lower(ltrim(btrim(${chatChannels.name}), '#')) IN ('funding', 'collections')`)).for("update");
    const report: { id: number; name: string; messageCount: number; removed: boolean }[] = [];
    for (const channel of channels) {
      const [messages] = await tx.select({ total: count() }).from(chatMessages)
        .where(eq(chatMessages.channelId, channel.id));
      const messageCount = Number(messages.total);
      if (messageCount === 0) await tx.delete(chatChannels).where(eq(chatChannels.id, channel.id));
      report.push({ id: channel.id, name: channel.name!, messageCount, removed: messageCount === 0 });
    }
    return report;
  });
}
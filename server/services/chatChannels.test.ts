import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { chatChannels, chatMembers, chatMessages, users } from "@shared/schema";
import {
  ChatChannelNameConflict,
  createChatChannelSchema,
  createPublicChatChannel,
  ensureDefaultChatChannels,
  retireEmptyLegacyChatChannels,
} from "./chatChannels";

after(async () => { await pool.end(); });

test("channel names are normalized, validated, and cannot set a private channel type", () => {
  assert.equal(createChatChannelSchema.parse({ name: " #My Team " }).name, "my-team");
  for (const name of ["", "  ", "#", "-bad", "bad/name", "a".repeat(51)]) {
    assert.throws(() => createChatChannelSchema.parse({ name }));
  }
  assert.throws(() => createChatChannelSchema.parse({ name: "secret", type: "direct" }));
});

test("real database: shared channels and safe retirement, all fixture writes rolled back", async () => {
  const before = await db.select({ id: chatChannels.id }).from(chatChannels).orderBy(chatChannels.id);
  const rollback = new Error("Rollback chat test fixtures");
  await assert.rejects(db.transaction(async tx => {
    const database = tx as unknown as typeof db;
    const staff = await tx.select({ id: users.id }).from(users).where(eq(users.status, "active")).limit(2);
    assert.equal(staff.length, 2, "Two active staff accounts required for team-sharing verification");
    await ensureDefaultChatChannels(database);
    await ensureDefaultChatChannels(database);
    const defaults = await tx.select().from(chatChannels).where(eq(chatChannels.type, "channel"));
    assert.equal(defaults.filter(c => c.name === "general").length, 1);
    assert.equal(defaults.filter(c => c.name === "operations").length, 1);
    const name = `smoke-team-${Date.now()}`;
    const custom = await createPublicChatChannel(` #${name.toUpperCase()} `, staff[0].id, database);
    assert.equal(custom.name, name);
    assert.equal(custom.type, "channel");
    assert((await tx.select().from(chatMembers).where(and(
      eq(chatMembers.channelId, custom.id), eq(chatMembers.userId, staff[0].id),
    ))).length === 1, "Creator can send immediately");
    const publicList = await tx.select().from(chatChannels).where(eq(chatChannels.type, "channel"));
    assert(publicList.some(channel => channel.id === custom.id), "Other staff can discover custom channel in public list");
    // Same idempotent automatic join used by GET /api/chat/channels.
    await tx.insert(chatMembers).values(publicList.map(channel => ({
      channelId: channel.id, userId: staff[1].id,
    }))).onConflictDoNothing();
    assert((await tx.select().from(chatMembers).where(and(
      eq(chatMembers.channelId, custom.id), eq(chatMembers.userId, staff[1].id),
    ))).length === 1, "Another staff member can join and participate");
    await assert.rejects(createPublicChatChannel(name.toUpperCase(), staff[1].id, database), ChatChannelNameConflict);

    // Test fixtures only; removing these happens solely inside this rolled-back transaction.
    const [funding] = await tx.insert(chatChannels).values({ name: "#FuNdInG", type: "channel" }).returning();
    const [collections] = await tx.insert(chatChannels).values({ name: "#CoLlEcTiOnS", type: "channel" }).returning();
    await tx.insert(chatMessages).values({ channelId: funding.id, senderId: staff[0].id, body: "History safety fixture" });
    const report = await retireEmptyLegacyChatChannels(database);
    assert.deepEqual(report.find(channel => channel.id === funding.id)?.messageCount, 1);
    assert.equal(report.find(channel => channel.id === funding.id)?.removed, false);
    assert.equal(report.find(channel => channel.id === collections.id)?.removed, true);
    assert((await tx.select().from(chatMessages).where(eq(chatMessages.channelId, funding.id))).length === 1);
    assert((await tx.select().from(chatChannels).where(eq(chatChannels.id, collections.id))).length === 0);
    // Advisory locking also protects canonical custom names from parallel requests.
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('team-chat:public-channel-names')) AS held`);
    assert.equal(lock.rows[0]?.held, true);
    throw rollback;
  }), error => error === rollback);
  assert.deepEqual(await db.select({ id: chatChannels.id }).from(chatChannels).orderBy(chatChannels.id), before);
});
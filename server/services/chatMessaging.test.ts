import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "../db";
import { chatChannels, chatMembers, chatMessages, notifications, users, userPermissions } from "@shared/schema";
import {
  chatPostSchema, createChatMessage, getChatThread, getMentionStaff,
  isRealActiveStaff, resolveMentions, staffWithHandles,
} from "./chatMessaging";

after(async () => { await pool.end(); });
const person = (id: string, firstName: string, extra = {}) => ({
  id, firstName, lastName: null, email: null, role: "employee", status: "active", isTestAccount: false, ...extra,
});

test("only real active staff receive deterministic, unambiguous mention handles", () => {
  const people = [
    person("a", "Maria"), person("b", "Pauli"), person("c", "Inactive", { status: "inactive" }),
    person("d", "RealLooking", { isTestAccount: true }), person("fixture-agent", "Synthetic"),
    person("e", "Demo"), person("f", "Dummy"), person("g", "Synthetic", { email: "agent@example.com" }),
  ];
  const directory = staffWithHandles(people);
  assert.deepEqual(directory.map(p => p.handle), ["maria", "pauli"]);
  assert.equal(isRealActiveStaff(person("h", "Testa")), true, "do not hide real names containing substrings");
  const duplicateNames = staffWithHandles([person("a", "Maria"), person("b", "Maria")]);
  assert.equal(new Set(duplicateNames.map(p => p.handle)).size, 2);
  assert.deepEqual(duplicateNames, staffWithHandles([person("b", "Maria"), person("a", "Maria")]));
});

test("mentions are authoritative spans, not email addresses or spoofed input", () => {
  const directory = staffWithHandles([person("a", "Maria"), person("b", "Pauli")]);
  const body = "🙂 Hi @maria, billing@maria.com, @PAULI and @maria.";
  const mentions = resolveMentions(body, directory);
  assert.deepEqual(mentions.map(m => m.userId), ["a", "b", "a"]);
  assert.deepEqual(mentions.map(m => body.slice(m.start, m.end)), ["@maria", "@PAULI", "@maria"]);
  assert.equal(resolveMentions("@unknown", directory).length, 0);
  for (const input of [{ body: "" }, { body: "hi", parentMessageId: 0 }, { body: "hi", parentMessageId: "1" },
    { body: "hi", mentions: [{ userId: "forged" }] }, { body: "x".repeat(10001) }]) {
    assert.throws(() => chatPostSchema.parse(input));
  }
});

test("real database: root-only stream, grouped replies, bell alerts, private scope and pagination; rollback all fixtures", async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const rollback = new Error("Rollback chat fixtures");
  let rootId = 0;
  await assert.rejects(db.transaction(async tx => {
    await tx.insert(users).values([
      { id: ids[0], firstName: "MentionAlpha", role: "employee", status: "active" },
      { id: ids[1], firstName: "MentionBeta", role: "employee", status: "active" },
      { id: ids[2], firstName: "MentionOutside", role: "employee", status: "active" },
      { id: ids[3], firstName: "RealLooking", role: "employee", status: "active", isTestAccount: true },
      { id: ids[4], firstName: "NoChatAccess", role: "employee", status: "active" },
    ]);
    await tx.insert(userPermissions).values({ userId: ids[4], permission: "tasks", granted: true });
    const [channel] = await tx.insert(chatChannels).values({ name: `thread-${randomUUID()}`, type: "channel" }).returning();
    const [direct] = await tx.insert(chatChannels).values({ type: "direct", directKey: JSON.stringify(ids.slice(0, 2).sort()) }).returning();
    await tx.insert(chatMembers).values([
      { channelId: channel.id, userId: ids[0] }, { channelId: channel.id, userId: ids[1] },
      { channelId: direct.id, userId: ids[0] }, { channelId: direct.id, userId: ids[1] },
    ]);
    const directory = await getMentionStaff(tx);
    assert(!directory.some(p => [ids[3], ids[4]].includes(p.id)));
    const beta = directory.find(p => p.id === ids[1])!;
    const outside = directory.find(p => p.id === ids[2])!;
    const root = await createChatMessage(tx, channel.id, ids[0], { body: "One topic" });
    rootId = root.id;
    const reply = await createChatMessage(tx, channel.id, ids[0], {
      body: `Please review @${beta.handle} and @${beta.handle}.`, parentMessageId: root.id,
    });
    assert.equal(reply.parentMessageId, root.id);
    assert.equal(reply.mentions.length, 2);
    const nested = await createChatMessage(tx, channel.id, ids[1], { body: "Reply to the reply", parentMessageId: reply.id });
    assert.equal(nested.parentMessageId, root.id, "flatten nesting under the original topic");
    const roots = await tx.select().from(chatMessages).where(and(eq(chatMessages.channelId, channel.id), isNull(chatMessages.parentMessageId)));
    assert.deepEqual(roots.map(row => row.id), [root.id]);
    const alerts = await tx.select().from(notifications).where(and(
      eq(notifications.entityId, reply.id), eq(notifications.entityType, "chat_mention"),
    ));
    assert.equal(alerts.length, 1, "deduplicate repeated tags");
    assert.equal(alerts[0].userId, ids[1]);
    assert.equal(alerts[0].entityType, "chat_mention");
    assert.equal(alerts[0].type, "warning");
    assert(alerts[0].actionUrl?.includes(`threadId=${root.id}&messageId=${reply.id}`));
    const small = await getChatThread(tx, channel.id, root.id, ids[0]);
    assert.equal(small.parent.replyCount, 2);
    assert.deepEqual(small.replies.map(row => row.id), [reply.id, nested.id]);
    const privateRoot = await createChatMessage(tx, direct.id, ids[0], { body: `Outside @${outside.handle}` });
    assert.equal(privateRoot.mentions.length, 0, "never notify an outsider about a private conversation");
    const privateDirectory = await getMentionStaff(tx, direct.id);
    assert(privateDirectory.every(p => ids.slice(0, 2).includes(p.id)));
    await assert.rejects(createChatMessage(tx, channel.id, ids[0], { body: "Cross channel", parentMessageId: privateRoot.id }), { statusCode: 404 });
    await assert.rejects(getChatThread(tx, direct.id, privateRoot.id, ids[2]), { statusCode: 403 });
    await tx.insert(chatMessages).values(Array.from({ length: 101 }, (_, i) => ({
      channelId: channel.id, senderId: ids[0], parentMessageId: root.id, body: `Older reply ${i}`,
    })));
    const firstPage = await getChatThread(tx, channel.id, root.id, ids[0]);
    assert.equal(firstPage.replies.length, 100);
    assert.equal(firstPage.hasMore, true);
    const secondPage = await getChatThread(tx, channel.id, root.id, ids[0], firstPage.nextCursor);
    assert.equal(secondPage.replies.length, 3);
    assert.equal(secondPage.hasMore, false);
    assert(secondPage.replies.every(row => row.id > firstPage.nextCursor));
    throw rollback;
  }), error => error === rollback);
  assert.equal((await db.select().from(users).where(eq(users.id, ids[0]))).length, 0);
  assert.equal((await db.select().from(chatMessages).where(eq(chatMessages.id, rootId))).length, 0);
});

test("real database: a failed bell write rolls back the message too", async () => {
  const senderId = randomUUID(), recipientId = randomUUID(), body = `Rollback-${randomUUID()} @atomicbeta`;
  const failure = new Error("Bell unavailable");
  await assert.rejects(db.transaction(async tx => {
    await tx.insert(users).values([
      { id: senderId, firstName: "AtomicAlpha", role: "employee", status: "active" },
      { id: recipientId, firstName: "AtomicBeta", role: "employee", status: "active" },
    ]);
    const [channel] = await tx.insert(chatChannels).values({ name: `atomic-${randomUUID()}`, type: "channel" }).returning();
    await tx.insert(chatMembers).values({ channelId: channel.id, userId: senderId });
    const broken = {
      select: tx.select.bind(tx), update: tx.update.bind(tx),
      insert: ((table: Parameters<typeof tx.insert>[0]) => {
        if (table === notifications) throw failure;
        return tx.insert(table);
      }) as typeof tx.insert,
    };
    await createChatMessage(broken, channel.id, senderId, { body });
  }), error => error === failure);
  assert.equal((await db.select().from(chatMessages).where(eq(chatMessages.body, body))).length, 0);
});

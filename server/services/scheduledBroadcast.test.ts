import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, users, emailBroadcasts, emailBroadcastDispatch } from "@shared/schema";
import { createEmailBroadcastService } from "./emailBroadcast";
import type { ResendEmailParams } from "../resendTransport";

after(async () => pool.end());
const rollback = new Error("rollback scheduled broadcast fixtures");
test("durable scheduled queue: no early send, dynamic scoped audience, restart, long confirmation age and individual transport", async () => {
  await assert.rejects(db.transaction(async tx => {
    const marker = `schedule-${randomUUID()}`;
    const [actor] = await tx.insert(users).values({ id: marker, role: "admin", status: "active", isTestAccount: true }).returning();
    const [first, removed] = await tx.insert(clients).values([
      { name: `${marker} One`, email: "one@example.test", status: "active" },
      { name: `${marker} Removed`, email: "removed@example.test", status: "active" },
    ]).returning();
    await tx.insert(emailBroadcastDispatch).values({ id: 1, nextSendAt: new Date(0) }).onConflictDoNothing();
    const ready = () => tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) }).where(eq(emailBroadcastDispatch.id, 1));
    let clock = new Date();
    const sendAt = new Date(clock.getTime() + 100 * 86400000);
    const deliveries: ResendEmailParams[] = [];
    const service = () => createEmailBroadcastService({ database: tx, now: () => clock, send: async params => {
      deliveries.push(params); return `isolated-${deliveries.length}`;
    } });
    const input = { requestId: randomUUID(), subject: "Closure: [Company]", body: "Hello [Company], editable closure hours.",
      filters: { search: marker, status: "active" }, scheduledAt: sendAt.toISOString(), scheduleTimeZone: "America/Denver" };
    const preview = await service().preview(actor.id, input);
    const id = preview.broadcast.id;
    assert.equal(preview.broadcast.counts.sendable, 2);
    await assert.rejects(service().confirm(actor.id, id, 2), /revision/i);
    await service().confirm(actor.id, id, 2, 1);
    assert.equal((await service().scheduled(actor.id))[0].status, "scheduled");
    await ready();
    assert.equal(await service().tick({ broadcastId: id }), false);
    assert.equal(deliveries.length, 0);
    await tx.update(clients).set({ status: "inactive" }).where(eq(clients.id, removed.id));
    const [added] = await tx.insert(clients).values({ name: `${marker} Added`, email: "new@example.test", status: "active" }).returning();
    // A new service instance simulates a process restart 100 days after confirmation.
    clock = new Date(sendAt.getTime() + 1000);
    assert.equal(await service().tick({ broadcastId: id }), false);
    const activated = await service().read(actor.id, id);
    assert.equal(activated.broadcast.status, "queued");
    assert.equal(activated.broadcast.confirmedAt, preview.broadcast.createdAt);
    assert.deepEqual(activated.recipients.map(row => row.clientId), [first.id, added.id]);
    assert.equal(deliveries.length, 0, "activation must commit recipient IDs before any provider call");
    await tx.insert(clients).values({ name: `${marker} Too Late`, email: "later@example.test", status: "active" });
    await ready(); await service().tick({ broadcastId: id });
    const throttle = await tx.execute<{ delayed: boolean }>(sql`select ${emailBroadcastDispatch.nextSendAt} > clock_timestamp() as delayed from ${emailBroadcastDispatch} where id=1`);
    assert.equal(throttle.rows[0].delayed, true);
    await ready(); await service().tick({ broadcastId: id });
    assert.equal(deliveries.length, 2);
    assert.deepEqual(deliveries.map(row => row.to), ["one@example.test", "new@example.test"]);
    for (const [index, delivery] of deliveries.entries()) {
      assert.equal(delivery.cc, undefined);
      assert.equal((delivery as any).bcc, undefined);
      assert.match(delivery.idempotencyKey!, new RegExp(`^broadcast/${id}/${activated.recipients[index].id}$`));
      assert(!delivery.text!.includes("[Company]"));
    }
    assert.equal((await service().read(actor.id, id)).broadcast.status, "completed");
    await ready(); await service().tick({ broadcastId: id });
    assert.equal(deliveries.length, 2);
    throw rollback;
  }), error => error === rollback);
});

test("schedule editing re-confirms, detects stale revisions; cancellation, late jobs and revoked senders never send", async () => {
  await assert.rejects(db.transaction(async tx => {
    const marker = `schedule-edit-${randomUUID()}`;
    const [actor, employee] = await tx.insert(users).values([
      { id: `${marker}-admin`, role: "admin", status: "active", isTestAccount: true },
      { id: `${marker}-employee`, role: "employee", status: "active", isTestAccount: true },
    ]).returning();
    const [client, outside] = await tx.insert(clients).values([
      { name: marker, email: "only@example.test", status: "active" },
      { name: `${marker} Other`, email: "outside@example.test", status: "active" },
    ]).returning();
    await tx.insert(emailBroadcastDispatch).values({ id: 1, nextSendAt: new Date(0) }).onConflictDoNothing();
    const ready = () => tx.update(emailBroadcastDispatch).set({ nextSendAt: new Date(0) }).where(eq(emailBroadcastDispatch.id, 1));
    let clock = new Date();
    let sends = 0;
    const service = createEmailBroadcastService({ database: tx, now: () => clock, send: async () => { sends++; return "isolated"; } });
    const input = () => ({ requestId: randomUUID(), subject: "Office closed", body: "Reviewed hours",
      filters: { search: marker }, clientIds: [client.id], scheduledAt: new Date(clock.getTime() + 600000).toISOString() });
    const original = await service.preview(actor.id, input());
    const id = original.broadcast.id;
    await service.confirm(actor.id, id, 1, 1);
    const editInput = { ...input(), subject: "Edited closure", expectedRevision: 1 };
    const edited = await service.editPreview(actor.id, id, editInput);
    assert.equal(edited.broadcast.status, "draft");
    assert.equal(edited.broadcast.revision, 2);
    assert.equal(edited.broadcast.confirmedAt, null);
    assert.deepEqual(edited.broadcast.clientIds, [client.id]);
    assert.equal((await service.editPreview(actor.id, id, editInput)).broadcast.revision, 2, "lost-response retry must not create a new revision");
    await assert.rejects(service.editPreview(actor.id, id, { ...input(), expectedRevision: 1 }), /changed/);
    await assert.rejects(service.confirm(actor.id, id, 1, 1), /revision/i);
    await service.confirm(actor.id, id, 1, 2);
    await service.cancel(actor.id, id);
    clock = new Date(clock.getTime() + 601000);
    await ready(); await service.tick({ broadcastId: id });
    assert.equal(sends, 0);
    for (const action of [
      () => service.preview(employee.id, input()), () => service.scheduled(employee.id),
      () => service.editPreview(employee.id, id, { ...input(), expectedRevision: 2 }),
      () => service.confirm(employee.id, id, 1, 2), () => service.cancel(employee.id, id),
    ]) await assert.rejects(action(), /administrators only/);
    await assert.rejects(service.preview(actor.id, { ...input(), scheduledAt: new Date(clock.getTime() - 1000).toISOString() }), /future/);
    await assert.rejects(service.preview(actor.id, { ...input(), scheduleTimeZone: "unknown/zone" }));
    const late = await service.preview(actor.id, input());
    await service.confirm(actor.id, late.broadcast.id, 1, 1);
    clock = new Date(clock.getTime() + 3 * 86400000);
    await ready(); await service.tick({ broadcastId: late.broadcast.id });
    assert.equal((await service.read(actor.id, late.broadcast.id)).broadcast.status, "failed");
    assert.match((await service.read(actor.id, late.broadcast.id)).broadcast.error!, /24 hours/);
    const revoked = await service.preview(actor.id, input());
    await service.confirm(actor.id, revoked.broadcast.id, 1, 1);
    await tx.update(users).set({ role: "employee" }).where(eq(users.id, actor.id));
    clock = new Date(clock.getTime() + 601000);
    await ready(); await service.tick({ broadcastId: revoked.broadcast.id });
    await tx.update(users).set({ role: "admin" }).where(eq(users.id, actor.id));
    assert.equal((await service.read(actor.id, revoked.broadcast.id)).broadcast.status, "failed");
    assert.match((await service.read(actor.id, revoked.broadcast.id)).broadcast.error!, /administrator/);
    assert.equal(sends, 0);
    assert.notEqual(client.id, outside.id);
    throw rollback;
  }), error => error === rollback);
});

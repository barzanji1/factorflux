import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { announcements, announcementDismissals, notifications, users } from "../../shared/schema";
import {
  ANNOUNCEMENT_LIFETIME_MS, announcementInput, announcementWordCount, type Announcement,
} from "../../shared/announcements";
import { listAnnouncements, mutateAnnouncement, type AnnouncementStore } from "./announcements";
import { registerAnnouncementRoutes } from "../routes/announcements";

after(() => pool.end());
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const input = (message = "Operational update", severity: "green" | "amber" | "red" = "green", persistent = false) => ({ message, severity, persistent });

async function fixture(run: (tx: Tx, ids: Record<"author" | "peer" | "manager" | "admin", string>) => Promise<void>) {
  const rollback = new Error("ROLLBACK_ANNOUNCEMENT_FIXTURES");
  await assert.rejects(db.transaction(async tx => {
    // Session-local copies keep even transient approved fixtures out of real
    // dashboard feeds, and never delete or update existing announcements.
    await tx.execute(sql.raw(`
      CREATE TEMP TABLE announcements (LIKE public.announcements INCLUDING ALL) ON COMMIT DROP;
      CREATE TEMP TABLE announcement_dismissals (LIKE public.announcement_dismissals INCLUDING ALL) ON COMMIT DROP;
      ALTER TABLE announcement_dismissals ADD FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;
      CREATE TEMP TABLE notifications (LIKE public.notifications INCLUDING ALL) ON COMMIT DROP;
    `));
    const ids = { author: `ann-author-${randomUUID()}`, peer: `ann-peer-${randomUUID()}`, manager: `ann-manager-${randomUUID()}`, admin: `ann-admin-${randomUUID()}` };
    for (const [name, id] of Object.entries(ids)) await tx.insert(users).values({
      id, firstName: name, lastName: "Fixture", role: name === "manager" || name === "admin" ? name : "employee",
      status: "active", isTestAccount: true,
    });
    await run(tx, ids);
    throw rollback;
  }), error => error === rollback);
}

test("word limit uses consistent whitespace counting and rejects forged fields", () => {
  assert.equal(announcementWordCount(" \n hello\tteam \r\n"), 2);
  assert.equal(announcementWordCount(" \n\t "), 0);
  assert.equal(announcementInput.safeParse(input("a ".repeat(100))).success, true);
  assert.equal(announcementInput.safeParse(input("a ".repeat(101))).success, false);
  for (const bad of [
    input("  "), { ...input(), severity: "blue" }, { ...input(), status: "approved" },
    { ...input(), authorId: "somebody-else" }, { ...input(), expiresAt: null }, { ...input(), persistent: "false" },
  ]) assert.equal(announcementInput.safeParse(bad).success, false);
});

test("agents submit privately; reviewers publish; severity/recency sorting and pagination work", async () => fixture(async (tx, ids) => {
  const draft = await mutateAnnouncement("create", ids.author, input("Agent submission"), undefined, tx) as Announcement;
  assert.equal(draft.status, "pending");
  assert.equal(draft.authorId, ids.author);
  assert.equal(draft.authorName, "author Fixture");
  assert.equal(draft.postedAt, null);
  assert.equal(new Date(draft.expiresAt!).getTime() - new Date(draft.createdAt).getTime(), ANNOUNCEMENT_LIFETIME_MS);
  assert.equal((await listAnnouncements(ids.peer, "active", 0, 15, tx)).total, 0);
  assert.deepEqual((await listAnnouncements(ids.author, "mine", 0, 15, tx)).items.map(row => row.id), [draft.id]);
  assert.equal((await listAnnouncements(ids.peer, "mine", 0, 15, tx)).total, 0);
  await assert.rejects(listAnnouncements(ids.author, "pending", 0, 15, tx), /Only admins and managers/);
  await assert.rejects(listAnnouncements(ids.author, "all", 0, 15, tx), /Only admins and managers/);
  await assert.rejects(mutateAnnouncement("approve", ids.author, { version: draft.version }, draft.id, tx), /Only admins and managers/);
  const green = await mutateAnnouncement("create", ids.manager, input("Manager live", "green"), undefined, tx) as Announcement;
  const amber = await mutateAnnouncement("create", ids.admin, input("Admin live", "amber"), undefined, tx) as Announcement;
  assert.equal(green.status, "approved");
  assert.equal(amber.status, "approved");
  const red1 = await mutateAnnouncement("create", ids.manager, input("Urgent earlier", "red"), undefined, tx) as Announcement;
  const red2 = await mutateAnnouncement("create", ids.admin, input("Urgent later", "red"), undefined, tx) as Announcement;
  await tx.update(announcements).set({ postedAt: new Date(Date.now() - 10000) }).where(eq(announcements.id, red1.id));
  const page1 = await listAnnouncements(ids.peer, "active", 0, 2, tx);
  assert.deepEqual(page1.items.map(row => row.id), [red2.id, red1.id]);
  assert.equal(page1.total, 4);
  assert.equal(page1.nextOffset, 2);
  assert.equal(page1.canReview, false);
  const page2 = await listAnnouncements(ids.peer, "active", 2, 2, tx);
  assert.deepEqual(page2.items.map(row => row.id), [amber.id, green.id]);
  assert.equal(page2.nextOffset, null);
  assert.equal((await listAnnouncements(ids.manager, "pending", 0, 15, tx)).items[0].id, draft.id);
  assert.equal(page1.items[0].canManage, false);
  assert.equal((await listAnnouncements(ids.admin, "all", 0, 15, tx)).total, 5);
}));

test("approval, reapproval after edits, stale reviews and author rejection notifications are atomic", async () => fixture(async (tx, ids) => {
  const draft = await mutateAnnouncement("create", ids.author, input(), undefined, tx) as Announcement;
  const approved = await mutateAnnouncement("approve", ids.manager, { version: draft.version }, draft.id, tx) as Announcement;
  assert.equal(approved.status, "approved");
  assert.equal(approved.reviewedBy, ids.manager);
  assert.ok(approved.reviewedAt && approved.postedAt);
  assert.equal(new Date(approved.expiresAt!).getTime() - new Date(approved.postedAt!).getTime(), ANNOUNCEMENT_LIFETIME_MS);
  await assert.rejects(mutateAnnouncement("reject", ids.admin, { version: draft.version }, draft.id, tx), /changed/);
  await assert.rejects(mutateAnnouncement("reject", ids.admin, { version: approved.version }, draft.id, tx), /already been reviewed/);
  await assert.rejects(mutateAnnouncement("edit", ids.peer, { ...input("Stolen"), version: approved.version }, draft.id, tx), /Only the author/);
  const edited = await mutateAnnouncement("edit", ids.author, { ...input("Revised", "red", true), version: approved.version }, draft.id, tx) as Announcement;
  assert.equal(edited.status, "pending", "an approved message cannot be changed without reapproval");
  assert.equal(edited.reviewedAt, null);
  assert.equal(edited.expiresAt, null);
  assert.equal((await listAnnouncements(ids.peer, "active", 0, 15, tx)).total, 0);
  const rejected = await mutateAnnouncement("reject", ids.admin, { version: edited.version, reason: "Please clarify the date." }, edited.id, tx) as Announcement;
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionReason, "Please clarify the date.");
  const alerts = await tx.select().from(notifications).where(eq(notifications.userId, ids.author));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /Please clarify the date/);
  assert.equal(alerts[0].entityId, edited.id);
  assert.equal(alerts[0].actionUrl, "/?announcements=mine");
  await assert.rejects(mutateAnnouncement("reject", ids.manager, { version: edited.version }, edited.id, tx), /changed/);
  const resubmitted = await mutateAnnouncement("edit", ids.author, { ...input("Clarified"), version: rejected.version }, rejected.id, tx) as Announcement;
  assert.equal(resubmitted.status, "pending");
  assert.equal(resubmitted.rejectionReason, null);
  const adminEdit = await mutateAnnouncement("edit", ids.admin, { ...input("Reviewed correction"), version: resubmitted.version }, resubmitted.id, tx) as Announcement;
  assert.equal(adminEdit.status, "approved");
  assert.equal(adminEdit.authorId, ids.author, "reviewer edits must not steal authorship");
}));

test("dismissals are personal/idempotent, survive edits, expire automatically and cascade on deletion", async () => fixture(async (tx, ids) => {
  const live = await mutateAnnouncement("create", ids.manager, input("Persistent bulletin", "green", true), undefined, tx) as Announcement;
  assert.equal(live.expiresAt, null);
  await mutateAnnouncement("dismiss", ids.author, { version: live.version }, live.id, tx);
  await mutateAnnouncement("dismiss", ids.author, { version: live.version }, live.id, tx);
  assert.equal((await tx.select().from(announcementDismissals)).length, 1);
  assert.equal((await listAnnouncements(ids.author, "active", 0, 15, tx)).total, 0);
  assert.equal((await listAnnouncements(ids.peer, "active", 0, 15, tx)).total, 1);
  const updated = await mutateAnnouncement("edit", ids.manager, { ...input("Updated bulletin", "red", true), version: live.version }, live.id, tx) as Announcement;
  assert.equal((await listAnnouncements(ids.author, "active", 0, 15, tx)).total, 0);
  await assert.rejects(mutateAnnouncement("delete", ids.peer, { version: updated.version }, live.id, tx), /Only the author/);
  await mutateAnnouncement("delete", ids.admin, { version: updated.version }, live.id, tx);
  assert.equal((await tx.select().from(announcementDismissals)).length, 0);
  const expiring = await mutateAnnouncement("create", ids.admin, input("One week only"), undefined, tx) as Announcement;
  await tx.update(announcements).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(announcements.id, expiring.id));
  assert.equal((await listAnnouncements(ids.peer, "active", 0, 15, tx)).total, 0);
  assert.equal((await listAnnouncements(ids.admin, "mine", 0, 15, tx)).total, 1);
  await assert.rejects(mutateAnnouncement("dismiss", ids.peer, { version: expiring.version }, expiring.id, tx), /no longer live/);
  const pending = await mutateAnnouncement("create", ids.author, input("Pending"), undefined, tx) as Announcement;
  await assert.rejects(mutateAnnouncement("dismiss", ids.peer, { version: pending.version }, pending.id, tx), /no longer live/);
  await mutateAnnouncement("delete", ids.author, { version: pending.version }, pending.id, tx);
}));

test("failed notification insert rolls back the rejection itself", async () => fixture(async (tx, ids) => {
  const draft = await mutateAnnouncement("create", ids.author, input(), undefined, tx) as Announcement;
  await tx.execute(sql.raw(`
    CREATE FUNCTION pg_temp.fail_announcement_notification() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'TEST_NOTIFICATION_FAILURE'; END; $$;
    CREATE TRIGGER fail_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_announcement_notification();
  `));
  await assert.rejects(mutateAnnouncement("reject", ids.manager, { version: draft.version }, draft.id, tx), /TEST_NOTIFICATION_FAILURE/);
  const [unchanged] = await tx.select().from(announcements).where(eq(announcements.id, draft.id));
  assert.equal(unchanged.status, "pending");
  assert.equal(unchanged.version, draft.version);
  assert.equal((await tx.select().from(notifications)).length, 0);
}));

test("HTTP routes enforce authentication, current database roles, input limits and version conflicts", async () => fixture(async (tx, ids) => {
  const app = express();
  app.use(express.json());
  registerAnnouncementRoutes(app, (req: any, res, next) => {
    const userId = req.headers["x-fixture-user"];
    if (typeof userId !== "string") return void res.sendStatus(401);
    req.user = { id: userId, role: "admin" }; // Intentionally untrusted cached role.
    next();
  }, tx as AnnouncementStore);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/announcements`;
  const request = (path = "", userId: string | null = ids.author, method = "GET", body?: unknown) =>
    fetch(base + path, { method, headers: { ...(userId ? { "x-fixture-user": userId } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await request("", null)).status, 401);
    assert.equal((await request("?view=pending")).status, 403);
    assert.equal((await request("?view=all")).status, 403);
    assert.equal((await request("?limit=1000")).status, 400);
    assert.equal((await request("?offset=-1")).status, 400);
    assert.equal((await request("", ids.author, "POST", { ...input(), status: "approved" })).status, 400);
    assert.equal((await request("", ids.author, "POST", input("word ".repeat(101)))).status, 400);
    const created = await request("", ids.author, "POST", input("HTTP pending"));
    assert.equal(created.status, 201);
    const item = await created.json() as Announcement;
    assert.equal(item.status, "pending", "forged cached admin role must not publish");
    assert.equal((await request(`/${item.id}/approve`, ids.author, "POST", { version: item.version })).status, 403);
    assert.equal((await request(`/${item.id}`, ids.peer, "PATCH", { ...input(), version: item.version })).status, 403);
    const approve = await request(`/${item.id}/approve`, ids.manager, "POST", { version: item.version });
    const reject = await request(`/${item.id}/reject`, ids.admin, "POST", { version: item.version });
    assert.equal(approve.status, 200);
    assert.equal(reject.status, 409);
    const mine = await request("?view=mine");
    assert.match(mine.headers.get("cache-control")!, /no-store/);
    await tx.update(users).set({ role: "employee" }).where(eq(users.id, ids.manager));
    assert.equal((await request("?view=pending", ids.manager)).status, 403, "demoted managers lose approval rights immediately");
    await tx.update(users).set({ status: "suspended" }).where(eq(users.id, ids.peer));
    assert.equal((await request("", ids.peer, "POST", input())).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}));

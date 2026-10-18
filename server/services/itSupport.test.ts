import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { users, itSupportRequests, itSupportNotifications, itSupportResponses } from "@shared/schema";
import { registerItSupportRoutes } from "../routes/itSupport";
import { IT_CONTACT_USER_ID, supportCreateSchema } from "./itSupport";

after(async () => { await pool.end(); });
test("one sidebar item, no recipient picker, no forged recipient or ownership", () => {
  const sidebar = fs.readFileSync("client/src/components/layout/sidebar.tsx", "utf8");
  assert.match(sidebar, /name: "IT Support"[^\n]+staffVisible: true/);
  assert.doesNotMatch(sidebar, /name: "Tickets"/);
  const page = fs.readFileSync("client/src/pages/it-support.tsx", "utf8");
  assert.doesNotMatch(page, /Save contact|canConfigure|staff\.map|contactMutation/);
  for (const extra of [{ submittedByAgentId: "other" }, { assignedTo: "other" }, { recipient: "other" }]) {
    assert.equal(supportCreateSchema.safeParse({ title: "Issue", description: "Steps", type: "bug", ...extra }).success, false);
  }
});
test("real API/DB: permanent contact, every submission bell, scoped acknowledgement, triage and cascading deletion", async () => {
  const rollback = new Error("Rollback fixture data");
  try {
    await db.transaction(async tx => {
      const staff = `support-${randomUUID()}`;
      const other = `support-${randomUUID()}`;
      const [dosh] = await tx.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, IT_CONTACT_USER_ID));
      assert.equal(dosh?.status, "active");
      await tx.insert(users).values([staff, other].map(id => ({ id, firstName: "Support", lastName: "Fixture", role: "employee" as const, status: "active" as const, isTestAccount: true })));
      const app = express();
      app.use(express.json());
      const identities = [staff, other, IT_CONTACT_USER_ID];
      registerItSupportRoutes(app, (req: any, res, next) => {
        const id = req.header("x-fixture-user");
        if (!identities.includes(id)) return void res.status(401).json({ message: "Sign in" });
        req.user = { id }; next();
      }, tx);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      const port = (server.address() as { port: number }).port;
      const api = async (who: string, method: string, path: string, body?: unknown, status = 200) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/it-support${path}`, {
          method, headers: { "Content-Type": "application/json", "x-fixture-user": who },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        return result;
      };
      try {
        const meta = await api(staff, "GET", "/meta");
        assert.equal(meta.contact.id, IT_CONTACT_USER_ID);
        assert.equal(meta.isContact, false);
        assert.equal(meta.staff, undefined);
        assert.equal(meta.canConfigure, undefined);
        await api(IT_CONTACT_USER_ID, "PUT", "/contact", { userId: other }, 405);
        const baseline = (await api(IT_CONTACT_USER_ID, "GET", "/unread-count")).count;
        const create = (who: string) => api(who, "POST", "/requests", { title: "Test issue", description: "Software issue", type: "bug" }, 201);
        const first = await create(staff);
        const second = await create(other);
        const own = await create(IT_CONTACT_USER_ID);
        assert.equal((await api(IT_CONTACT_USER_ID, "GET", "/unread-count")).count, baseline + 3, "every submission, including Dosh's own, notifies Dosh");
        const notifications = await tx.select({ userId: itSupportNotifications.userId }).from(itSupportNotifications)
          .where(eq(itSupportNotifications.requestId, first.id));
        assert.deepEqual(notifications.map(row => row.userId), [IT_CONTACT_USER_ID]);
        await api(other, "GET", `/requests/${first.id}`, undefined, 404);
        await api(staff, "GET", "/requests?scope=triage", undefined, 403);
        await api(staff, "PATCH", `/requests/${first.id}`, { status: "resolved" }, 403);
        assert.ok((await api(IT_CONTACT_USER_ID, "GET", "/requests?scope=triage")).some((row: any) => row.id === first.id));
        await api(IT_CONTACT_USER_ID, "GET", `/requests/${first.id}`);
        assert.equal((await api(IT_CONTACT_USER_ID, "GET", "/unread-count")).count, baseline + 2);
        await api(IT_CONTACT_USER_ID, "PATCH", `/requests/${first.id}`, { status: "in_progress", response: "Investigating." });
        assert.equal((await api(staff, "GET", "/unread-count")).count, 1);
        await api(IT_CONTACT_USER_ID, "PATCH", `/requests/${first.id}`, { status: "in_progress" });
        assert.equal((await api(staff, "GET", "/unread-count")).count, 1);
        const detail = await api(staff, "GET", `/requests/${first.id}`);
        assert.equal(detail.canManage, false);
        assert.ok(detail.responses.some((row: any) => row.body === "Investigating."));
        assert.equal((await api(staff, "GET", "/unread-count")).count, 0);
        await api(IT_CONTACT_USER_ID, "DELETE", `/requests/${first.id}`, { confirm: true }, 409);
        await api(IT_CONTACT_USER_ID, "PATCH", `/requests/${first.id}`, { status: "resolved" });
        await api(IT_CONTACT_USER_ID, "DELETE", `/requests/${first.id}`, {}, 400);
        await api(IT_CONTACT_USER_ID, "DELETE", `/requests/${first.id}`, { confirm: true });
        for (const table of [itSupportRequests, itSupportResponses, itSupportNotifications]) {
          const column = table === itSupportRequests ? itSupportRequests.id : table.requestId;
          const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(table).where(eq(column, first.id));
          assert.equal(count.count, 0);
        }
        assert.ok(second.id && own.id);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});

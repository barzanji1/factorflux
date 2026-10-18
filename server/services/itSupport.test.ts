import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { users, itSupportRequests, itSupportNotifications, itSupportResponses } from "@shared/schema";
import { registerItSupportRoutes } from "../routes/itSupport";
import { supportCreateSchema, supportUpdateSchema } from "./itSupport";

after(async () => { await pool.end(); });
test("IT input schemas reject forged submitter, status, management flags and blank requests", () => {
  const valid = { title: "Issue", description: "Steps to reproduce", type: "bug" };
  assert.equal(supportCreateSchema.parse(valid).priority, "medium");
  for (const extra of [{ submittedByAgentId: "someone" }, { status: "resolved" }, { isItSupport: true }]) {
    assert.equal(supportCreateSchema.safeParse({ ...valid, ...extra }).success, false);
  }
  assert.equal(supportCreateSchema.safeParse({ ...valid, title: " " }).success, false);
  assert.equal(supportUpdateSchema.safeParse({ status: "approved" }).success, false);
});
test("IT Support remains an all-staff authenticated route, separate from operational tickets", () => {
  const routes = fs.readFileSync("server/routes.ts", "utf8");
  assert.ok(routes.includes('if (/^\\/api\\/it-support(?:\\/|$)/.test(pathname)) return requireAuth(req, res, next);'));
  assert.ok(routes.includes("registerItSupportRoutes(app, requireAuth)"));
  assert.ok(routes.includes('app.get("/api/tickets"'));
  const sidebar = fs.readFileSync("client/src/components/layout/sidebar.tsx", "utf8");
  assert.match(sidebar, /name: "IT Support"[^\n]+staffVisible: true/);
});
test("real database/API full loop: saved contact, scoped alerts, ownership, no-ops, reassignment and cascade deletion", async () => {
  const rollback = new Error("Intentional fixture rollback");
  try {
    await db.transaction(async tx => {
      const prefix = `it-${randomUUID()}`;
      const ids = { admin: `${prefix}-admin`, submitter: `${prefix}-staff`, handler: `${prefix}-handler`, other: `${prefix}-other`, next: `${prefix}-next`, inactive: `${prefix}-inactive`, test: `${prefix}-test` };
      await tx.update(users).set({ isItSupport: false }).where(eq(users.isItSupport, true));
      await tx.insert(users).values(Object.entries(ids).map(([key, id]) => ({
        id, firstName: `IT ${key}`, lastName: "Fixture", role: key === "admin" ? "admin" as const : "employee" as const,
        status: key === "inactive" ? "inactive" as const : "active" as const, isTestAccount: key === "test",
      })));
      const app = express();
      app.use(express.json());
      registerItSupportRoutes(app, (req: any, res, next) => {
        const userId = req.header("x-fixture-user");
        if (!Object.values(ids).includes(userId)) return void res.status(401).json({ message: "Authentication required" });
        req.user = { id: userId };
        next();
      }, tx);
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      const address = server.address() as { port: number };
      const api = async (who: keyof typeof ids | null, method: string, path: string, body?: unknown, expected = 200) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/it-support${path}`, {
          method, headers: { "Content-Type": "application/json", ...(who ? { "x-fixture-user": ids[who] } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        assert.match(response.headers.get("content-type") || "", /application\/json/);
        const result = await response.json();
        assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
        return result;
      };
      try {
        await api(null, "GET", "/meta", undefined, 401);
        await api("inactive", "GET", "/meta", undefined, 403);
        await api("submitter", "PUT", "/contact", { userId: ids.handler }, 403);
        await api("admin", "PUT", "/contact", { userId: ids.inactive }, 403);
        await api("admin", "PUT", "/contact", { userId: ids.test }, 400);
        // A request before configuration stays queued and receives a forward alert on assignment.
        const pending = await api("other", "POST", "/requests", { title: "Queued before contact", description: "Software issue", type: "question" }, 201);
        await api("admin", "PUT", "/contact", { userId: ids.handler });
        const [saved] = await tx.select({ assigned: users.isItSupport }).from(users).where(eq(users.id, ids.handler));
        assert.equal(saved.assigned, true, "assignment was written to the database, not just returned in the UI");
        await tx.execute(sql`SAVEPOINT single_contact_check`);
        await assert.rejects(tx.update(users).set({ isItSupport: true }).where(eq(users.id, ids.next)));
        await tx.execute(sql`ROLLBACK TO SAVEPOINT single_contact_check`);
        const create = (title: string) => api("submitter", "POST", "/requests", { title, description: "Reproduction details", type: "bug", priority: "high" }, 201);
        const first = await create("PDF viewer issue");
        const second = await create("Search issue");
        assert.equal(first.submittedByAgentId, ids.submitter);
        assert.equal((await api("handler", "GET", "/unread-count")).count, 3);
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 0);
        await api("other", "GET", `/requests/${first.id}`, undefined, 404);
        await api("admin", "GET", `/requests/${first.id}`, undefined, 404);
        await api("submitter", "GET", "/requests?scope=triage", undefined, 403);
        assert.equal((await api("submitter", "GET", "/requests?scope=mine")).length, 2);
        const queue = await api("handler", "GET", "/requests?scope=triage");
        assert.ok(queue.some((row: any) => row.id === first.id));
        await api("submitter", "PATCH", `/requests/${first.id}`, { status: "resolved" }, 403);
        await api("submitter", "DELETE", `/requests/${first.id}`, { confirm: true }, 403);
        await api("handler", "DELETE", `/requests/${first.id}`, { confirm: true }, 409);
        await api("handler", "GET", `/requests/${first.id}`);
        assert.equal((await api("handler", "GET", "/unread-count")).count, 2);
        await api("handler", "PATCH", `/requests/${first.id}`, { status: "submitted" });
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 0, "unchanged status must not notify");
        await api("handler", "PATCH", `/requests/${first.id}`, { status: "in_progress", response: "Investigating now." });
        await api("handler", "PATCH", `/requests/${second.id}`, { response: "Please provide the affected screen." });
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 2);
        const detail = await api("submitter", "GET", `/requests/${first.id}`);
        assert.ok(detail.responses.some((row: any) => row.body === "Investigating now."));
        assert.equal(detail.canManage, false);
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 1, "other unopened request remains unread");
        assert.equal((await api("handler", "GET", "/unread-count")).count, 2, "submitter acknowledgement cannot clear triage alerts");
        assert.equal((await api("other", "GET", "/unread-count")).count, 0);
        await api("handler", "PATCH", `/requests/${first.id}`, { status: "resolved" });
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 2);
        await api("submitter", "GET", `/requests/${first.id}`);
        assert.equal((await api("submitter", "GET", "/unread-count")).count, 1);
        await api("handler", "DELETE", `/requests/${first.id}`, {}, 400);
        await api("handler", "DELETE", `/requests/${first.id}`, { confirm: true });
        for (const table of [itSupportRequests, itSupportResponses, itSupportNotifications]) {
          const column = table === itSupportRequests ? itSupportRequests.id : (table === itSupportResponses ? itSupportResponses.requestId : itSupportNotifications.requestId);
          const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(table).where(eq(column, first.id));
          assert.equal(count.count, 0, "no request, response or notification orphan");
        }
        const own = await api("handler", "POST", "/requests", { title: "Own request", description: "An idea", type: "feature_idea" }, 201);
        assert.equal((await api("handler", "GET", "/unread-count")).count, 2, "no self-submission alert");
        await api("handler", "PATCH", `/requests/${own.id}`, { response: "Own note", status: "in_progress" });
        assert.equal((await api("handler", "GET", "/unread-count")).count, 2, "no self-update alert");
        await api("admin", "PUT", "/contact", { userId: ids.next });
        assert.deepEqual(await api("handler", "GET", "/unread-count"), { count: 0, mode: "updates" });
        await api("handler", "PATCH", `/requests/${second.id}`, { status: "resolved" }, 403);
        assert.equal((await api("next", "GET", "/unread-count")).mode, "triage");
        assert.equal((await api("next", "GET", "/unread-count")).count >= 3, true);
        await api("next", "GET", `/requests/${pending.id}`);
        const before = await api("next", "GET", "/unread-count");
        await api("admin", "PUT", "/contact", { userId: ids.next });
        assert.deepEqual(await api("next", "GET", "/unread-count"), before, "saving unchanged assignment does not replay alerts");
        await api("next", "GET", "/missing-endpoint", undefined, 404);
        await api("next", "POST", "/requests", { title: "Forged", description: "body", type: "bug", submittedByAgentId: ids.other }, 400);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { users, clientEmailTemplates } from "../../shared/schema";
import { createEmailTemplateService } from "./emailTemplates";
import { registerEmailTemplateRoutes } from "../routes/emailTemplates";

after(() => pool.end());

test("staff can save shared templates through authenticated JSON API; persistence, validation and permission gates (rollback)", async () => {
  const rollback = new Error("rollback template fixtures");
  await assert.rejects(db.transaction(async tx => {
    const actorId = `email-template-${randomUUID()}`;
    await tx.insert(users).values({ id: actorId, role: "employee", status: "active", isTestAccount: true, firstName: "Template fixture" });
    const service = createEmailTemplateService(tx);
    const app = express(); app.use(express.json());
    registerEmailTemplateRoutes(app, {
      service,
      requireAuth(req: any, res, next) {
        if (!req.header("x-test-auth")) return void res.status(401).json({ message: "Sign in" });
        req.user = { id: actorId, role: "employee" }; next();
      },
      requireEmailPermission(req, res, next) {
        if (!req.header("x-test-email")) return void res.status(403).json({ message: "Email permission required" });
        next();
      },
    });
    app.use((_req, res) => res.type("html").send("<!DOCTYPE html>SPA"));
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/client-email/templates`;
      const headers = { "Content-Type": "application/json", "x-test-auth": "1", "x-test-email": "1" };
      for (const method of ["GET", "POST"]) {
        assert.equal((await fetch(base, { method })).status, 401);
        assert.equal((await fetch(base, { method, headers: { "x-test-auth": "1" } })).status, 403);
      }
      const draft = { name: `Office notice ${randomUUID()}`, subject: "Custom holiday for [Company]", body: "Hello [Company],\n\nOur office is closed." };
      const savedResponse = await fetch(base, { method: "POST", headers, body: JSON.stringify(draft) });
      assert.equal(savedResponse.status, 201);
      assert(savedResponse.headers.get("content-type")?.includes("application/json"));
      const saved = await savedResponse.json();
      assert.match(saved.id, /^custom:/);
      assert.equal(saved.kind, "custom");
      assert.equal(saved.body, draft.body);
      const [stored] = await tx.select().from(clientEmailTemplates).where(eq(clientEmailTemplates.id, saved.id));
      assert.equal(stored.createdBy, actorId);
      assert.equal(stored.subject, draft.subject);
      // A fresh service reads the DB, rather than a process-local cache.
      assert((await createEmailTemplateService(tx).list()).some(row => row.id === saved.id && row.name === draft.name));
      const listResponse = await fetch(base, { headers });
      const listed = await listResponse.json();
      assert(listed.some((row: any) => row.id === saved.id));
      assert(listed.some((row: any) => row.id === "holiday-thanksgiving"));
      assert.equal(listResponse.headers.get("cache-control"), "no-store");
      const bad = await fetch(base, { method: "POST", headers, body: JSON.stringify({ ...draft, createdBy: "admin" }) });
      assert.equal(bad.status, 400);
      assert((await bad.json()).message);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    throw rollback;
  }), error => error === rollback);
});

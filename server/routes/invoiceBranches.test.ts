import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { insertInvoiceSchema } from "../../shared/schema";

process.env.NEON_DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { registerInvoiceBranchRoutes } = await import("./invoiceBranches");
const { pool } = await import("../db");
after(() => pool.end());

test("invoice Branch and Buyout are optional and nullable; empty Branch is null", () => {
  const fields = insertInvoiceSchema.pick({ branchId: true, buyout: true });
  assert(fields.safeParse({}).success);
  assert.deepEqual(fields.parse({ branchId: "", buyout: "" }), { branchId: null, buyout: null });
  assert.deepEqual(fields.parse({ branchId: null, buyout: null }), { branchId: null, buyout: null });
  assert.equal(fields.parse({ branchId: "12" }).branchId, 12);
  for (const branchId of [0, -1, "bad"]) assert(!fields.safeParse({ branchId }).success);
});

test("inline branch creation is authenticated, scoped, validated and returns the saved branch", async () => {
  const app = express();
  app.use(express.json());
  let creates = 0;
  registerInvoiceBranchRoutes(app, (req, res, next) => {
    if (!req.get("x-fixture-auth")) return void res.status(401).json({ message: "Authentication required" });
    next();
  }, async (_req, brokerId) => brokerId !== 2, {
    broker: async id => id === 4 ? undefined : { id, status: id === 3 ? "inactive" : "active" },
    create: async input => { creates++; return { ...input, id: 101, createdAt: new Date(), updatedAt: new Date() } as any; },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const address = server.address(); assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/invoices/broker-branches`;
  const post = (body: object, auth = true) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { "x-fixture-auth": "employee" } : {}) },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await post({ brokerId: 1, branchName: "Branch" }, false)).status, 401);
    assert.equal((await post({ brokerId: 1, branchName: "   " })).status, 400);
    assert.equal((await post({ brokerId: 1, branchName: "Branch", email: "bad" })).status, 400);
    assert.equal((await post({ brokerId: 2, branchName: "Branch" })).status, 403);
    assert.equal((await post({ brokerId: 3, branchName: "Branch" })).status, 400);
    assert.equal((await post({ brokerId: 4, branchName: "Branch" })).status, 404);
    const response = await post({ brokerId: 1, branchName: "  New branch  ", contactName: "Contact", email: "contact@example.test" });
    assert.equal(response.status, 201);
    const branch = await response.json();
    assert.equal(branch.id, 101); assert.equal(branch.brokerId, 1);
    assert.equal(branch.branchName, "New branch"); assert.equal(branch.status, "active");
    assert.equal(creates, 1);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

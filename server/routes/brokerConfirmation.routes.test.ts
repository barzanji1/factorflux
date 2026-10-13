import test from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { registerBrokerConfirmationRoutes } from "./brokerConfirmation";
import { brokerConfirmationService, ConfirmationError, type ConfirmationStore } from "../services/brokerConfirmationService";
import { apiNotFound } from "../apiNotFound";

test("Broker-tab routes return JSON for reads, assignment, errors, and missing methods before SPA", async t => {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req: any, res, next) => {
    const role = req.get("x-fixture-role");
    if (!role) return void res.status(401).json({ message: "Authentication required" });
    req.user = { id: "fixture-agent", role }; next();
  };
  const manager: RequestHandler = (req: any, res, next) => auth(req, res, () => {
    if (!["manager", "admin"].includes(req.user.role)) return void res.status(403).json({ message: "Manager required" });
    next();
  });
  const assignments: unknown[] = [];
  const service = {
    ...brokerConfirmationService,
    details: async (id: number) => {
      if (id === 404) throw new ConfirmationError(404, "Invoice not found.");
      if (id === 500) throw new Error("Isolated fixture service failure");
      return { invoiceId: id, status: "pending", sentAt: null, events: [], canResend: false };
    },
    reassign: async (id: number, agentId: string | null) => { assignments.push({ id, agentId }); return { message: "Assigned." }; },
    sendForInvoice: async () => { throw new ConfirmationError(409, "Invoice must be funded."); },
  } as typeof brokerConfirmationService;
  const chain: any = {
    from: () => chain, where: () => chain,
    orderBy: async () => [{ id: "fixture-agent", name: "Fixture Agent" }],
  };
  registerBrokerConfirmationRoutes(app, { requireAuth: auth, requireManagerOrAdmin: manager,
    canAccessInvoice: async (_req, id) => id !== 403,
    store: { select: () => chain } as unknown as ConfirmationStore, service });
  app.use("/api", apiNotFound);
  app.use((_req, res) => res.type("html").send("<!DOCTYPE html><html>SPA</html>"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = async (path: string, method = "GET", body?: unknown, role = "manager") => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { "Content-Type": "application/json", ...(role ? { "x-fixture-role": role } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    assert.equal(response.redirected, false);
    return { status: response.status, body: await response.json() };
  };
  const prefix = "/api/invoices/42/broker-confirmation";
  assert.equal((await request(prefix)).body.status, "pending");
  assert.deepEqual((await request(prefix)).body.events, []);
  assert.equal((await request(`${prefix}/agents`)).body[0].name, "Fixture Agent");
  assert.equal((await request(`${prefix}/assignment`, "PATCH", { agentId: "fixture-agent" })).status, 200);
  assert.equal(assignments.length, 1);
  assert.equal((await request(`${prefix}/assignment`, "PATCH", { agentId: 1 })).status, 400);
  assert.equal((await request(`${prefix}/assignment`, "PATCH", {}, "employee")).status, 403);
  assert.equal((await request(`${prefix}/agents`, "GET", undefined, "employee")).status, 403);
  assert.equal((await request(prefix, "GET", undefined, "")).status, 401);
  assert.equal((await request("/api/invoices/403/broker-confirmation")).status, 403);
  assert.equal((await request("/api/invoices/404/broker-confirmation")).status, 404);
  assert.equal((await request("/api/invoices/500/broker-confirmation")).status, 500);
  assert.equal((await request(`${prefix}/resend`, "POST", {})).status, 409);
  assert.equal((await request(`${prefix}/assignment`)).status, 404, "wrong GET method cannot reach SPA");
  assert.equal((await request(prefix, "POST", {})).status, 404);
  assert.equal((await request("/api/agents")).status, 404, "obsolete picker path cannot reach SPA");
});

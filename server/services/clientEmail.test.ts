import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, users, clientEmailLogs, type ClientEmailLog } from "@shared/schema";
import {
  CLIENT_EMAIL_FROM, CLIENT_EMAIL_REPLY_TO, ClientEmailError,
  clientEmailSchema, createClientEmailService, createClientEmailStore, createResendSender,
  type ClientEmailStore,
} from "./clientEmail";

after(async () => { await pool.end(); });
const client = { id: 123, email: "delivered@resend.dev" };
const agent = { id: "fixture-agent", name: "Test Agent" };
const input = () => ({ clientId: client.id, requestId: randomUUID(), subject: "Document request", body: "Please send the requested documents." });

function fakeStore(): ClientEmailStore & { rows: ClientEmailLog[] } {
  const rows: ClientEmailLog[] = [];
  return {
    rows,
    async reserve(draft) {
      let log = rows.find(row => row.requestId === draft.requestId);
      if (!log) {
        log = { ...draft, id: rows.length + 1, createdAt: new Date(), updatedAt: new Date(),
          providerMessageId: null, errorMessage: null, sentAt: null } as ClientEmailLog;
        rows.push(log);
      }
      return { ...log };
    },
    async claim(id) {
      const log = rows.find(row => row.id === id)!;
      if (log.status === "sending" || log.status === "sent") return undefined;
      log.status = "sending";
      return { ...log };
    },
    async update(id, fields) {
      const log = rows.find(row => row.id === id)!;
      Object.assign(log, fields);
      return { ...log };
    },
  };
}

test("schema rejects recipient/sender/actor spoofing, blank content and multiline subject", () => {
  for (const extra of [{ to: "other@example.com" }, { from: "other@example.com" }, { agentId: "admin" }, { replyTo: "other@example.com" }]) {
    assert.throws(() => clientEmailSchema.parse({ ...input(), ...extra }));
  }
  assert.throws(() => clientEmailSchema.parse({ ...input(), subject: "  " }));
  assert.throws(() => clientEmailSchema.parse({ ...input(), body: "" }));
  assert.throws(() => clientEmailSchema.parse({ ...input(), subject: "Message\r\nBcc: another@example.com" }));
  assert.throws(() => clientEmailSchema.parse({ ...input(), requestId: "invalid" }));
});

test("Resend payload fixes domain, monitored reply-to, recipient and retry idempotency", async () => {
  let captured: any;
  const store = fakeStore();
  const sender = createResendSender(async (connector, path, options) => {
    captured = { connector, path, ...options };
    return new Response(JSON.stringify({ id: "provider-fixture" }), { status: 200 });
  });
  const draft = input();
  const log = await createClientEmailService(store, sender)(draft, client, agent);
  assert.equal(captured.connector, "resend");
  assert.equal(captured.path, "/emails");
  assert.equal(captured.body.from, CLIENT_EMAIL_FROM);
  assert.equal(captured.body.from, "TruckingPros Financial <clients@truckingprosfinancial.com>");
  assert.equal(captured.body.reply_to, CLIENT_EMAIL_REPLY_TO);
  assert.deepEqual(captured.body.to, [client.email]);
  assert.equal(captured.headers["Idempotency-Key"], `client-email/${draft.requestId}`);
  assert.equal(log.agentId, agent.id);
  assert.equal(log.agentName, agent.name);
  assert.equal(log.body, draft.body);
  assert.equal(log.status, "sent");
  assert.equal(log.providerMessageId, "provider-fixture");
  assert(log.sentAt);
});

test("duplicate/concurrent requests send once and cannot reuse another agent's email", async () => {
  const store = fakeStore();
  let count = 0;
  let finish: (value: string) => void = () => {};
  const service = createClientEmailService(store, async () => { count++; return new Promise(resolve => { finish = resolve; }); });
  const draft = input();
  const pending = service(draft, client, agent);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(service(draft, client, agent), /already being sent/);
  finish("same-provider-id");
  await pending;
  assert.equal((await service(draft, client, agent)).status, "sent");
  assert.equal(count, 1);
  await assert.rejects(service(draft, client, { id: "other", name: "Other Agent" }), /different email/);
  await assert.rejects(service({ ...draft, body: "changed" }, client, agent), /different email/);
});

test("provider failure is logged, network ambiguity remains unconfirmed, retry keeps its identity", async () => {
  const store = fakeStore();
  const failed = createClientEmailService(store, createResendSender(async () =>
    new Response(JSON.stringify({ message: "Domain is not verified" }), { status: 403 })));
  await assert.rejects(failed(input(), client, agent), /Domain is not verified/);
  assert.equal(store.rows[0].status, "failed");
  const draft = input();
  const uncertain = createClientEmailService(store, createResendSender(async () => { throw new Error("Network interruption"); }));
  await assert.rejects(uncertain(draft, client, agent), /could not be confirmed/);
  assert.equal(store.rows[1].status, "unconfirmed");
  const retry = createClientEmailService(store, async () => "reconciled-id");
  const sent = await retry(draft, client, agent);
  assert.equal(sent.requestId, draft.requestId);
  assert.equal(sent.status, "sent");
  assert.equal(store.rows.length, 2);
  store.rows[1].status = "unconfirmed";
  store.rows[1].createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await assert.rejects(retry(draft, client, agent), /manual verification/);
});

test("missing recipient and pre-send log failures never call Resend; post-send failure is explicit", async () => {
  let sent = 0;
  const store = fakeStore();
  const service = createClientEmailService(store, async () => { sent++; return "id"; });
  await assert.rejects(service(input(), { ...client, email: "" }, agent), /valid email/);
  assert.equal(sent, 0);
  const blocked = createClientEmailService({ ...store, reserve: async () => { throw new Error("Database unavailable"); } }, async () => { sent++; return "id"; });
  await assert.rejects(blocked(input(), client, agent), /Database unavailable/);
  assert.equal(sent, 0);
  const statusFailure = createClientEmailService({ ...store, update: async () => { throw new Error("Database unavailable"); } }, async () => { sent++; return "id"; });
  await assert.rejects(statusFailure(input(), client, agent), (error: any) =>
    error instanceof ClientEmailError && error.uncertain && /Resend accepted/.test(error.message));
  assert.equal(store.rows.length, 1, "Content and agent log exists before the provider call");
  assert.equal(store.rows[0].status, "sending");
});

test("real database stores accepted message and sender, with all fixtures rolled back", async () => {
  const before = await db.select({ id: clientEmailLogs.id }).from(clientEmailLogs);
  const rollback = new Error("Rollback email log fixtures");
  await assert.rejects(db.transaction(async tx => {
    const [record] = await tx.select({ id: clients.id }).from(clients).limit(1);
    const [staff] = await tx.select({ id: users.id }).from(users).where(eq(users.status, "active")).limit(1);
    assert(record && staff, "An existing client and staff account are required");
    const service = createClientEmailService(createClientEmailStore(tx as unknown as typeof db), async log => {
      const [persisted] = await tx.select().from(clientEmailLogs).where(eq(clientEmailLogs.id, log.id));
      assert.equal(persisted.status, "sending");
      return "mock-provider-id";
    });
    const result = await service({ ...input(), clientId: record.id }, { id: record.id, email: client.email }, { id: staff.id, name: agent.name });
    assert.equal(result.status, "sent");
    const [saved] = await tx.select().from(clientEmailLogs).where(eq(clientEmailLogs.id, result.id));
    assert.equal(saved.agentId, staff.id);
    assert.equal(saved.toEmail, client.email);
    assert.equal(saved.providerMessageId, "mock-provider-id");
    throw rollback;
  }), error => error === rollback);
  assert.deepEqual(await db.select({ id: clientEmailLogs.id }).from(clientEmailLogs), before);
});
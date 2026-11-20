import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { pool } from "../db";
import { createBrokerPortalAuth, brokerIdentity, tokenHash, portalCsrf, portalRateLimit, revokeBrokerSession } from "./brokerPortalAuth";
import { createBrokerConfirmationService } from "./brokerConfirmationService";
import {
  listBrokerInvoices, getBrokerInvoice, respondToBrokerInvoice, listBrokerDocuments, brokerDocumentUrl,
  uploadBrokerDocument, addBrokerNote, brokerNotes,
} from "./brokerPortalInvoices";
import { registerBrokerPortalRoutes } from "../routes/brokerPortal";
import { prepareDocument } from "./documentCompression";
import { storage } from "../storage";

test("Broker Portal: verified tenant isolation, auth, shared responses, paperwork and conversations (rolled back)", { timeout: 120000 }, async () => {
  const client = await pool.connect();
  await client.query("BEGIN");
  let depth = 0, failAudit = false;
  const query = async (config: any, values?: any[]) => {
    const text = typeof config === "string" ? config : config.text;
    if (text.toLowerCase() === "begin") return client.query(`SAVEPOINT broker_test_${++depth}`);
    if (text.toLowerCase() === "commit") return client.query(`RELEASE SAVEPOINT broker_test_${depth--}`);
    if (text.toLowerCase() === "rollback") {
      await client.query(`ROLLBACK TO SAVEPOINT broker_test_${depth}`);
      return client.query(`RELEASE SAVEPOINT broker_test_${depth--}`);
    }
    if (failAudit && /insert into "?event_ledger"?/i.test(text)) return client.query("SELECT 1/0");
    return client.query(config, values);
  };
  const connectMock = mock.method(pool, "connect", async () => ({ query, release() {} }));
  const queryMock = mock.method(pool, "query", query);
  const suffix = randomUUID().slice(0, 10), email = `broker-${suffix}@example.test`;
  const staffId = `portal-staff-${suffix}`, password = "Portal-test-password-291!";
  const delivered: Array<{ to: unknown; text: string; html: string }> = [];
  let clock = new Date();
  const auth = createBrokerPortalAuth({
    send: async params => { delivered.push({ to: params.to, text: params.text || "", html: params.html || "" }); return true; },
    now: () => clock,
  });
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await client.query("INSERT INTO users(id,email,first_name,last_name,role) VALUES($1,$2,'Portal','Tester','admin')", [staffId, `staff-${suffix}@example.test`]);
    const makeBroker = async (address: string) => (await client.query(`INSERT INTO brokers(name,contact_person,email,phone,status)
      VALUES($1,'Fictional Contact',$2,'5550101111','active') RETURNING id`, [`Fictional Portal Broker ${suffix}`, address])).rows[0].id as number;
    const brokerId = await makeBroker(email), otherBrokerId = await makeBroker(`other-${email}`);
    const carrierId = (await client.query("INSERT INTO clients(name) VALUES($1) RETURNING id", [`Fictional Portal Carrier ${suffix}`])).rows[0].id;
    const makeInvoice = async (broker: number, label: string, funded = true) => (await client.query(`INSERT INTO invoices(invoice_number,client_id,broker_id,
      load_id,amount,status,funded_at,submitted_at,submitted_by,confirmation_sent_at)
      VALUES($1,$2,$3,NULL,1200.00,$4,$5,now(),$6,now()) RETURNING id,broker_confirmation_token`,
    [`PORTAL-${suffix}-${label}`, carrierId, broker, funded ? "funded" : "submitted", funded ? new Date() : null, staffId])).rows[0];
    const first = await makeInvoice(brokerId, "CONFIRM"), second = await makeInvoice(brokerId, "DISPUTE");
    const other = await makeInvoice(otherBrokerId, "OTHER"), unfunded = await makeInvoice(brokerId, "UNFUNDED", false);
    const fields = { companyName: "Fictional Portal Broker", contactName: "Fictional Contact", email: ` ${email.toUpperCase()} `, phone: "5550101111", password };

    await auth.register({ ...fields, email: `not-a-contact-${email}` });
    assert.equal(delivered.length, 0, "Unmatched company/email must never get an access link");
    const duplicate = await makeBroker(email);
    await auth.register(fields);
    assert.equal(delivered.length, 0, "Ambiguous broker emails must fail closed");
    await client.query("DELETE FROM brokers WHERE id=$1", [duplicate]);
    await auth.register(fields);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].html, /Broker Portal/);
    const verification = new URL(delivered[0].text.trim().split("\n").at(-1)!).searchParams.get("token")!;
    assert.ok(verification && verification.length === 64);
    assert.doesNotMatch(delivered[0].text, /replit\.dev/);
    const storedToken = (await client.query("SELECT token_hash FROM broker_portal_tokens")).rows.find(row => row.token_hash === tokenHash(verification));
    assert.ok(storedToken);
    assert.notEqual(storedToken.token_hash, verification);
    await assert.rejects(auth.login({ email, password }), /not yet verified/i);
    await assert.rejects(auth.redeem(verification, "verify", "Wrong-password"), /password/i);
    const token = await auth.redeem(verification, "verify", password);
    const actor = await brokerIdentity(token);
    assert.equal(actor.brokerId, brokerId);
    assert.equal(actor.email, email);
    await assert.rejects(auth.redeem(verification, "verify", password), /expired/i);
    const loginToken = await auth.login({ email, password });
    assert.equal((await brokerIdentity(loginToken)).id, actor.id);
    await assert.rejects(auth.login({ email, password: "Not-the-password" }), /credentials/i);
    await auth.magic(email);
    const magicToken = new URL(delivered.at(-1)!.text.trim().split("\n").at(-1)!).searchParams.get("token")!;
    const magicSession = await auth.redeem(magicToken, "magic");
    assert.equal((await brokerIdentity(magicSession)).brokerId, brokerId);
    await assert.rejects(auth.redeem(magicToken, "magic"), /expired/i);
    await auth.magic(email);
    const expired = new URL(delivered.at(-1)!.text.trim().split("\n").at(-1)!).searchParams.get("token")!;
    clock = new Date(+clock + 16 * 60 * 1000);
    await assert.rejects(auth.redeem(expired, "magic"), /expired/i);
    clock = new Date();
    await revokeBrokerSession(magicSession);
    await assert.rejects(brokerIdentity(magicSession), /sign in/i);
    for (let n = 0; n < 5; n++) await portalRateLimit("magic/test", email, 5);
    await assert.rejects(portalRateLimit("magic/test", email, 5), /Too many/i);

    const list = await listBrokerInvoices(actor, {});
    assert.equal(list.pageSize, 15);
    assert.equal(list.total, 3);
    assert.ok(list.invoices.every(i => i.id !== other.id));
    await assert.rejects(getBrokerInvoice(actor, other.id), /not found/i);
    await assert.rejects(respondToBrokerInvoice(actor, other.id, "confirmed"), /not found/i);
    await assert.rejects(respondToBrokerInvoice(actor, unfunded.id, "confirmed"), /not been funded/i);
    assert.equal((await getBrokerInvoice(actor, unfunded.id)).canRespond, false);
    await respondToBrokerInvoice(actor, first.id, "confirmed");
    const confirmed = await getBrokerInvoice(actor, first.id);
    assert.equal(confirmed.status, "confirmed");
    assert.ok(confirmed.actedAt);
    assert.match(confirmed.actedBy, /portal:/);
    assert.equal(confirmed.canRespond, false);
    await assert.rejects(respondToBrokerInvoice(actor, first.id, "disputed", "Opposite response"), /already been confirmed/i);
    await assert.rejects(createBrokerConfirmationService().brokerRespond(first.broker_confirmation_token, "disputed", "Email opposite"), /already been confirmed/i);
    await createBrokerConfirmationService().brokerRespond(second.broker_confirmation_token, "disputed", "Email paperwork mismatch");
    const disputed = await getBrokerInvoice(actor, second.id);
    assert.equal(disputed.status, "disputed");
    assert.equal(disputed.disputeReason, "Email paperwork mismatch");
    assert.ok(disputed.actedAt);
    await assert.rejects(respondToBrokerInvoice(actor, second.id, "confirmed"), /already been disputed/i);
    assert.equal((await listBrokerInvoices(actor, { status: "confirmed" })).total, 1);
    assert.equal((await listBrokerInvoices(actor, { status: "disputed" })).total, 1);
    assert.equal((await listBrokerInvoices(actor, { status: "pending" })).total, 1);
    const rollbackInvoice = await makeInvoice(brokerId, "ROLLBACK");
    failAudit = true;
    await assert.rejects(respondToBrokerInvoice(actor, rollbackInvoice.id, "confirmed"));
    failAudit = false;
    assert.equal((await getBrokerInvoice(actor, rollbackInvoice.id)).status, "pending");

    const note = await addBrokerNote(first.id, { message: "Please review this document." }, { name: actor.contactName, brokerUserId: actor.id, brokerId });
    await addBrokerNote(first.id, { message: "Reviewed. Thank you.", parentId: note.id }, { name: "TPF team", staffUserId: staffId });
    const thread = await brokerNotes(first.id, 1, brokerId);
    assert.equal(thread.notes.length, 2);
    assert.equal(thread.notes[0].authorKind, "staff");
    assert.equal(thread.notes[0].parentId, note.id);
    await assert.rejects(addBrokerNote(other.id, { message: "Wrong tenant", parentId: note.id }, { name: actor.contactName, brokerUserId: actor.id, brokerId }), /not found/i);
    await assert.rejects(addBrokerNote(second.id, { message: "Wrong parent", parentId: note.id }, { name: actor.contactName, brokerUserId: actor.id, brokerId }), /this invoice/i);
    assert.equal((await brokerNotes(other.id, 1, brokerId)).notes.length, 0);

    const file = () => ({ buffer: Buffer.from("%PDF-1.4\n% fictional tiny PDF fixture\n%%EOF"), originalname: "support.pdf", mimetype: "application/pdf", size: 42 }) as Express.Multer.File;
    let uploads = 0, compensations = 0;
    const effects = { upload: async (f: Express.Multer.File, key: string) => { await prepareDocument(f); uploads++; return key; }, compensate: async (_key: string) => { compensations++; } };
    await assert.rejects(uploadBrokerDocument(actor, other.id, "other", file(), effects), /not found/i);
    assert.equal(uploads, 0);
    await assert.rejects(uploadBrokerDocument(actor, first.id, "other", { ...file(), buffer: Buffer.from("<script>bad</script>") }, effects), /valid PDF/i);
    const uploaded = await uploadBrokerDocument(actor, first.id, "rate_confirmation", file(), effects);
    assert.equal(uploads, 1);
    assert.equal((await listBrokerDocuments(actor, first.id)).documents[0].id, uploaded.id);
    assert.ok((await storage.getDocumentsByInvoice(first.id)).some(d => d.id === uploaded.id), "Internal invoice documents must include broker uploads");
    const document = (await client.query("SELECT * FROM documents WHERE id=$1", [uploaded.id])).rows[0];
    assert.equal(document.uploaded_by, null);
    assert.equal(document.uploaded_by_broker_portal_user_id, actor.id);
    assert.equal(document.load_id, null);
    assert.equal(document.source_channel, "portal");
    assert.equal(document.original_size, file().buffer.length);
    await assert.rejects(brokerDocumentUrl(actor, other.id, uploaded.id, async () => "never"), /not found/i);
    const download = await brokerDocumentUrl(actor, first.id, uploaded.id, async (_key, name, ttl) => { assert.equal(name, "support.pdf"); assert.equal(ttl, 60); return "https://example.test/signed"; });
    assert.equal(download, "https://example.test/signed");
    failAudit = true;
    await assert.rejects(uploadBrokerDocument(actor, first.id, "other", file(), effects));
    failAudit = false;
    assert.equal(compensations, 1, "Failed DB commits compensate uploaded objects");
    assert.equal((await listBrokerDocuments(actor, first.id)).documents.length, 1);

    const app = express(); app.use(express.json());
    registerBrokerPortalRoutes(app, { requireAuth: (_req, res) => { res.status(401).json({ message: "Staff session required" }); }, requireInvoiceRead: (_req, _res, next) => next(), canAccessInvoice: async () => true });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
    const cookie = `tpf_broker_session=${token}`, csrf = portalCsrf(token);
    assert.equal((await fetch(`${base}/api/broker/invoices`)).status, 401);
    const me = await fetch(`${base}/api/broker/me`, { headers: { cookie } });
    assert.equal(me.status, 200);
    const publicMe = await me.json();
    assert.equal(publicMe.user.brokerId, undefined);
    assert.equal(publicMe.user.passwordHash, undefined);
    assert.equal((await fetch(`${base}/api/broker/invoices/${other.id}`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/broker/invoices/${first.id}/notes`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ message: "No CSRF" }) })).status, 403);
    assert.equal((await fetch(`${base}/api/broker/invoices/${first.id}/notes`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-Broker-CSRF": csrf, origin: "https://attacker.example.test" }, body: JSON.stringify({ message: "Wrong origin" }) })).status, 403);
    assert.equal((await fetch(`${base}/api/broker-portal-staff/invoices/${first.id}/notes`, { headers: { cookie } })).status, 401);
    assert.equal((await fetch(`${base}/api/broker/unknown`, { headers: { cookie } })).status, 404);
    const multipart = new FormData();
    multipart.append("file", new Blob(["Invalid PDF fixture"], { type: "application/pdf" }), "invalid.pdf");
    multipart.append("documentType", "other");
    const invalidFile = await fetch(`${base}/api/broker/invoices/${first.id}/documents`, { method: "POST", headers: { cookie, "X-Broker-CSRF": csrf }, body: multipart });
    assert.equal(invalidFile.status, 400);
    assert.match((await invalidFile.json()).message, /valid PDF/i, "Both valid multipart parts must reach file signature validation");
    assert.equal((await fetch(`${base}/api/broker/invoices/${first.id}/notes`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-Broker-CSRF": csrf }, body: JSON.stringify({ message: "Authenticated HTTP note." }) })).status, 201);
    await client.query("UPDATE brokers SET email=$2 WHERE id=$1", [brokerId, `changed-${email}`]);
    await assert.rejects(brokerIdentity(token), /sign in/i);
    console.log("Broker portal workflow verified; no real emails, S3 objects, or fixture records retained.");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    queryMock.mock.restore(); connectMock.mock.restore();
    await client.query("ROLLBACK"); client.release(); await pool.end();
  }
});

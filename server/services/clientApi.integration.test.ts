import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { pool } from "../db";
import { createClientAuth, consumeClientRegistrationAttempt } from "./clientApiAuth";
import { registerClientApiRoutes } from "../routes/clientApi";
import { changeClientFundingStep, clientFundingProgress } from "./clientFunding";
import { deliverClientPush } from "./clientPush";
import { deleteFromS3Strict } from "./s3Service";
import { runInvoicePreflight } from "./invoicePreflight";
import { authenticateCurrentUser, requirePermission, requireAnyPermission } from "../middleware/requirePermission";

test("Client API: verified contact binding, JWT isolation, intake, real S3 document, funding gates, notes and mocked FCM", { timeout: 120000 }, async () => {
  const connection = await pool.connect(); await connection.query("BEGIN");
  let depth = 0;
  const query = async (config: any, values?: any[]) => {
    const text = typeof config === "string" ? config : config.text;
    if (text.toLowerCase() === "begin") return connection.query(`SAVEPOINT client_api_test_${++depth}`);
    if (text.toLowerCase() === "commit") return connection.query(`RELEASE SAVEPOINT client_api_test_${depth--}`);
    if (text.toLowerCase() === "rollback") {
      await connection.query(`ROLLBACK TO SAVEPOINT client_api_test_${depth}`);
      return connection.query(`RELEASE SAVEPOINT client_api_test_${depth--}`);
    }
    return connection.query(config, values);
  };
  const connectMock = mock.method(pool, "connect", async () => ({ query, release() {} }));
  const queryMock = mock.method(pool, "query", query);
  const suffix = randomUUID().slice(0, 9), password = `Client-${randomUUID()}`, admin = `client-test-admin-${suffix}`, employee = `client-test-agent-${suffix}`;
  const emailA = `client-a-${suffix}@example.test`, emailB = `client-b-${suffix}@example.test`;
  const verification = new Map<string, string>(), objectKeys: string[] = [];
  const auth = createClientAuth(async (email, token) => { verification.set(email, token); return true; });
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    for (const [id, role] of [[admin, "admin"], [employee, "employee"]]) await query(
      "INSERT INTO users(id,email,first_name,role,is_test_account) VALUES($1,$2,'Fictional Client API Tester',$3,true)", [id, `${id}@example.test`, role]);
    const carrierA = (await query("INSERT INTO clients(name,email,mc_number) VALUES($1,$2,'991234501') RETURNING id", [`Fictional API Carrier A ${suffix}`, emailA])).rows[0].id;
    const carrierB = (await query("INSERT INTO clients(name,email,mc_number) VALUES($1,$2,'991234502') RETURNING id", [`Fictional API Carrier B ${suffix}`, emailB])).rows[0].id;
    const carrierC = (await query("INSERT INTO clients(name,email,mc_number) VALUES($1,$2,'991234503') RETURNING id", [`Fictional API Carrier C ${suffix}`, `original-${suffix}@example.test`])).rows[0].id;
    const register = (email: string, mcNumber = "991234501") => auth.register({ companyName: "Fictional Client API", contactName: "Fictional Contact", email, phone: "5550101111", mcNumber, password });
    const a = await register(emailA, "991234502"); // Public MC B must never grant B access.
    await assert.rejects(auth.login({ email: emailA, password }), /Verify/);
    const aVerification = verification.get(emailA)!;
    assert.equal((await auth.verify(aVerification)).status, "active");
    assert.equal((await query("SELECT carrier_id FROM carrier_portal_users WHERE id=$1", [a.id])).rows[0].carrier_id, carrierA);
    await assert.rejects(auth.verify(aVerification), /expired or already used/);
    const b = await register(emailB, "991234502"); await auth.verify(verification.get(emailB));
    const pendingEmail = `new-${suffix}@example.test`, pending = await register(pendingEmail);
    assert.equal((await auth.verify(verification.get(pendingEmail))).status, "pending");
    await assert.rejects(auth.login({ email: pendingEmail, password }), /pending admin approval/);
    await query("UPDATE carrier_portal_users SET carrier_id=$2,status='active',reviewed_by=$3,reviewed_at=now() WHERE id=$1", [pending.id, carrierC, employee]);
    await assert.rejects(auth.login({ email: pendingEmail, password }), /pending admin approval/, "An employee's legacy approval must not grant new client JWT access");
    await auth.resend({ email: pendingEmail, password });
    assert.equal((await auth.verify(verification.get(pendingEmail))).status, "pending");
    assert.equal((await query("SELECT status FROM carrier_portal_users WHERE id=$1", [pending.id])).rows[0].status, "active",
      "New client verification must not disable an existing legacy portal account");
    await assert.rejects(auth.login({ email: pendingEmail, password }), /pending admin approval/);
    await query("UPDATE carrier_portal_users SET reviewed_by=$2 WHERE id=$1", [pending.id, admin]);
    assert.equal((await auth.login({ email: pendingEmail, password })).client.carrierId, carrierC);
    await assert.rejects(register(emailA.toUpperCase()), /already exists/);
    const tokenA = (await auth.login({ email: emailA.toUpperCase(), password })).token;
    const tokenB = (await auth.login({ email: emailB, password })).token;
    const claims = JSON.parse(Buffer.from(tokenA.split(".")[1], "base64url").toString());
    assert.equal(claims.aud, "tpf-client-api"); assert.equal(claims.exp - claims.iat, 3600);

    const broker = (await query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Fixture Contact',$2,'5550101111') RETURNING id",
      [`Fictional API Broker ${suffix}`, `broker-${suffix}@example.test`])).rows[0].id;
    const branch = (await query("INSERT INTO broker_branches(broker_id,branch_name) VALUES($1,'Fictional Branch') RETURNING id", [broker])).rows[0].id;
    const bank = (await query(`INSERT INTO client_vault(client_id,data_type,label,encrypted_data)
      VALUES($1,'bank_account','Fictional Bank','fixture-never-decrypted') RETURNING id`, [carrierA])).rows[0].id;
    const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
    app.use((req: any, _res, next) => { req.session = req.get("x-fixture-staff") ? { user: { id: req.get("x-fixture-staff") } } : {}; next(); });
    registerClientApiRoutes(app, {
      requireAuth: authenticateCurrentUser, requireSubmissionAccess: requirePermission("portal_submissions"),
      requireInvoiceRead: requireAnyPermission(["invoices", "factoring"]),
      canAccessInvoice: async (req, id) => req.user.role === "admin" || !!(await query("SELECT id FROM invoices WHERE id=$1 AND submitted_by=$2", [id, req.user.id])).rowCount,
      preflight: runInvoicePreflight, nearAlerts: async () => [],
      decide: (alerts, acknowledgements, _user, override) => {
        assert.equal(override, false);
        const accepted = !alerts.some(alert => alert.severity === "block" || alert.severity === "ack" && !acknowledgements.some((ack: any) => ack.code === alert.code));
        return { accepted, acknowledgements };
      },
    }, auth);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const client = (path: string, token = tokenA, method = "GET", body?: any) => fetch(base + path, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const staff = (path: string, method = "GET", body?: any, id = admin) => fetch(base + path, { method,
      headers: { "x-fixture-staff": id, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await client("/api/client/dashboard", "")).status, 401);
    assert.equal((await fetch(base + "/api/client/dashboard", { headers: { "x-fixture-staff": admin } })).status, 401);
    assert.equal((await client("/api/client/dashboard", tokenA.slice(0, -3) + "bad")).status, 401);
    assert.equal((await client("/api/internal/submissions/1/step", tokenA, "PUT", {})).status, 401);

    const submissionBody: any = { loadNumber: `LOAD-${suffix}`, invoiceNumber: `CINV-${suffix}`, loadType: "FTL", brokerId: broker,
      branchId: branch, code: "STANDARD", lumper: "no", driverName: "Fictional Driver", bankAccountId: bank, amount: "1000.00", paymentType: "ACH" };
    // Use the app's supported load type, not a test-only invented enum member.
    const options = await (await client("/api/client/submission-options")).json();
    submissionBody.loadType = options.loadTypes[0];
    let created = await client("/api/client/submissions", tokenA, "POST", submissionBody), payload = await created.json();
    if (created.status === 409 && payload.details?.alerts) {
      submissionBody.acknowledgements = payload.details.alerts.filter((a: any) => a.severity === "ack").map((a: any) => ({ code: a.code, reason: "Fictional isolated integration test acknowledgement" }));
      created = await client("/api/client/submissions", tokenA, "POST", submissionBody); payload = await created.json();
    }
    assert.equal(created.status, 201, JSON.stringify(payload));
    const submissionId = payload.id;
    assert.equal(payload.driverName, submissionBody.driverName); assert.equal(payload.branchId, branch); assert.equal(payload.bankAccountId, bank);
    assert.equal(payload.fundingStatus, "received"); assert.ok(payload.step1ReceivedAt);
    assert.equal((await client("/api/client/submissions", tokenA, "POST", submissionBody)).status, 409);
    assert.equal((await client(`/api/client/submissions/${submissionId}`, tokenB)).status, 404);
    for (const tail of ["documents", "notes"]) assert.equal((await client(`/api/client/submissions/${submissionId}/${tail}`, tokenB)).status, 404);
    assert.equal((await client(`/api/client/submissions/${submissionId}/notes`, tokenB, "POST", { message: "Not mine" })).status, 404);
    assert.equal((await client("/api/client/submissions?page=0")).status, 400);
    assert.equal((await (await client("/api/client/submissions")).json()).pageSize, 15);

    // A real, small PDF passes the production compression/S3 path. Never send
    // emails or real push notifications; S3 objects are explicitly removed.
    const pdf = new PDFDocument(); const chunks: Buffer[] = [];
    const pdfDone = new Promise<Buffer>(resolve => { pdf.on("data", c => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); });
    pdf.text("Fictional client API test. No customer information."); pdf.end();
    const bytes = await pdfDone, form = new FormData();
    form.append("documents", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "fictional-api-test.pdf");
    form.append("documentTypes", JSON.stringify(["rate_confirmation"]));
    const upload = await fetch(`${base}/api/client/submissions/${submissionId}/documents`, { method: "POST", headers: { authorization: `Bearer ${tokenA}` }, body: form });
    const uploaded = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(uploaded));
    assert.equal(uploaded.items[0].originalSize, bytes.length); assert.ok(uploaded.items[0].compressedSize > 0);
    objectKeys.push(...(await query("SELECT s3_key FROM carrier_submission_documents WHERE submission_id=$1 AND s3_key IS NOT NULL", [submissionId])).rows.map(r => r.s3_key));
    assert.equal((await query("SELECT count(*)::int AS n FROM client_upload_intents WHERE portal_user_id=$1", [a.id])).rows[0].n, 0);
    const doc = uploaded.items[0].id;
    assert.equal((await client(`/api/client/submissions/${submissionId}/documents/${doc}/download`, tokenB)).status, 404);
    const download = await (await client(`/api/client/submissions/${submissionId}/documents/${doc}/download`)).json(); assert.ok(download.url.startsWith("https://"));
    const downloaded = await fetch(download.url);
    assert.equal(downloaded.status, 200);
    assert.equal((await downloaded.arrayBuffer()).byteLength, uploaded.items[0].compressedSize);

    await query("INSERT INTO entity_notes(entity_type,entity_id,user_id,note_text) VALUES('submission',$1,$2,'PRIVATE STAFF NOTE DO NOT SHARE')", [submissionId, admin]);
    assert.equal((await client(`/api/client/submissions/${submissionId}/notes`, tokenA, "POST", { message: "Client-visible question" })).status, 201);
    assert.equal((await client(`/api/client/submissions/${submissionId}/notes`, tokenA, "POST", { message: "Fake staff", senderType: "staff" })).status, 400);
    const device = `fixture-device-${randomUUID()}`;
    assert.equal((await client("/api/client/push-token", tokenA, "POST", { token: device, platform: "ios" })).status, 201);
    assert.equal((await client("/api/client/push-token", tokenB, "POST", { token: device, platform: "ios" })).status, 409);
    assert.equal((await staff(`/api/internal/submissions/${submissionId}/notes`, "POST", { message: "Client-visible staff reply" })).status, 201);
    const notes = await (await client(`/api/client/submissions/${submissionId}/notes`)).json();
    assert.equal(notes.items.length, 2); assert.ok(!JSON.stringify(notes).includes("PRIVATE STAFF NOTE"));
    assert.equal((await staff(`/api/internal/submissions/${submissionId}/step`, "PUT", { fundingStatus: "funded", expectedStatus: "received" })).status, 409);
    await changeClientFundingStep(submissionId, employee, { fundingStatus: "under_review", expectedStatus: "received" });
    await assert.rejects(changeClientFundingStep(submissionId, admin, { fundingStatus: "funded", expectedStatus: "under_review" }), /matching invoice/);
    const invoice = (await query(`INSERT INTO invoices(invoice_number,carrier_invoice_number,load_number,client_id,broker_id,load_id,amount,status,submitted_by)
      VALUES($1,$2,$3,$4,$5,NULL,'1000.00','funded',$6) RETURNING id`, [`INT-${suffix}`, submissionBody.invoiceNumber, submissionBody.loadNumber, carrierA, broker, admin])).rows[0].id;
    await assert.rejects(changeClientFundingStep(submissionId, admin, { fundingStatus: "funded", expectedStatus: "under_review" }), /completed and verified/);
    const payout = (await query(`INSERT INTO payouts(invoice_id,client_id,invoice_amount,advance_rate,fee_rate,advance_amount,fee_amount,reserve_amount,net_payout)
      VALUES($1,$2,1000,95,2,950,19.88,50,930.12) RETURNING id`, [invoice, carrierA])).rows[0].id;
    assert.equal((await clientFundingProgress(submissionId, true)).fundingVerified, false);
    await query("UPDATE invoices SET funded_at=now() WHERE id=$1", [invoice]);
    await query("UPDATE payouts SET payment_status='advance_paid',advance_paid_at=now(),advance_paid_by=$2 WHERE id=$1", [payout, admin]);
    const payoutBefore = (await query("SELECT * FROM payouts WHERE id=$1", [payout])).rows[0];
    const progress = await changeClientFundingStep(submissionId, employee, { fundingStatus: "funded", expectedStatus: "under_review" });
    assert.equal(progress.fundedAmount, "930.12"); assert.ok(progress.step3FundedAt); assert.equal(progress.stepChangedBy, employee);
    assert.equal(progress.history[0].to, "funded"); assert.equal(progress.history.length, 2);
    const dashboard = await (await client("/api/client/dashboard")).json();
    assert.equal(dashboard.fundedThisWeekCount, 1); assert.equal(dashboard.fundedThisWeekTotal, "930.12");
    const privateDetail = await (await client(`/api/client/submissions/${submissionId}`)).json();
    assert.equal(privateDetail.progress.history, undefined); assert.equal(privateDetail.progress.stepChangedBy, undefined);
    await assert.rejects(changeClientFundingStep(submissionId, employee, { fundingStatus: "received", expectedStatus: "funded", reason: "no" }), /five characters/);
    await changeClientFundingStep(submissionId, employee, { fundingStatus: "under_review", expectedStatus: "funded", reason: "Correct client progress only" });
    assert.deepEqual((await query("SELECT * FROM payouts WHERE id=$1", [payout])).rows[0], payoutBefore, "Reverting tracking must not reverse a payout");
    await assert.rejects(changeClientFundingStep(submissionId, employee, { fundingStatus: "received", expectedStatus: "funded", reason: "Stale request" }), /changed/);
    await changeClientFundingStep(submissionId, admin, { fundingStatus: "funded", expectedStatus: "under_review" });
    assert.equal((await clientFundingProgress(submissionId, true)).history.length, 4);
    const jobs = (await query("SELECT body FROM client_push_deliveries WHERE portal_user_id=$1", [a.id])).rows;
    assert.ok(jobs.some(r => r.body.includes("$930.12 sent"))); assert.ok(jobs.some(r => r.body.includes("No additional payment")));
    const sent: any[] = [];
    while (await deliverClientPush(async message => { sent.push(message); return "mock-only-not-sent"; }, a.id)) { /* Drain only this fixture's jobs. */ }
    assert.equal(sent.length, 5); assert.ok(sent.every(m => m.data.submissionId === String(submissionId)));
    assert.equal((await client("/api/client/push-token", tokenA, "DELETE", { token: device })).status, 200);
    assert.equal((await client("/api/client/push-token", tokenB, "POST", { token: device, platform: "android" })).status, 201);
    await client("/api/client/push-token", tokenA, "POST", { token: `second-fixture-${randomUUID()}`, platform: "ios" });
    await query("UPDATE carrier_portal_users SET carrier_id=$2,reviewed_by=$3 WHERE id=$1", [a.id, carrierB, admin]);
    const reassignedToken = (await auth.login({ email: emailA, password })).token;
    assert.equal((await client("/api/client/dashboard")).status, 401, "Changing a carrier binding invalidates old JWTs");
    assert.equal((await client(`/api/client/submissions/${submissionId}`, reassignedToken)).status, 404);
    assert.equal((await client(`/api/client/submissions/${submissionId}/documents`, reassignedToken)).status, 404);
    assert.equal((await client(`/api/client/submissions/${submissionId}/notes`, reassignedToken, "POST", { message: "Wrong carrier" })).status, 404);
    assert.equal((await (await client("/api/client/submissions", reassignedToken)).json()).items.length, 0);
    await staff(`/api/internal/submissions/${submissionId}/notes`, "POST", { message: "Old carrier note must not notify a reassigned account" });
    let wrongCarrierPushes = 0;
    await deliverClientPush(async () => { wrongCarrierPushes++; return "mock-only"; }, a.id);
    assert.equal(wrongCarrierPushes, 0);
    await query("UPDATE carrier_portal_users SET carrier_id=$2,reviewed_by=NULL WHERE id=$1", [a.id, carrierA]);
    await staff(`/api/internal/submissions/${submissionId}/notes`, "POST", { message: "Test retry and invalid-device handling" });
    await deliverClientPush(async () => { throw Object.assign(new Error("Mock transient failure"), { code: "messaging/unavailable" }); }, a.id);
    const retryJob = (await query("SELECT id,state,attempts FROM client_push_deliveries WHERE portal_user_id=$1 ORDER BY id DESC LIMIT 1", [a.id])).rows[0];
    assert.equal(retryJob.state, "queued"); assert.equal(retryJob.attempts, 1);
    await query("UPDATE client_push_deliveries SET next_attempt_at=now() WHERE id=$1", [retryJob.id]);
    await deliverClientPush(async () => { throw Object.assign(new Error("Mock unregistered device"), { code: "messaging/registration-token-not-registered" }); }, a.id);
    assert.equal((await query("SELECT state FROM client_push_deliveries WHERE id=$1", [retryJob.id])).rows[0].state, "skipped");
    assert.equal((await query("SELECT count(*)::int AS n FROM client_push_tokens WHERE portal_user_id=$1 AND active", [a.id])).rows[0].n, 0);
    const quotaTokens = Array.from({ length: 11 }, () => `quota-fixture-${randomUUID()}`);
    for (const token of quotaTokens.slice(0, 10)) assert.equal((await client("/api/client/push-token", tokenA, "POST", { token, platform: "ios" })).status, 201);
    assert.equal((await client("/api/client/push-token", tokenA, "POST", { token: quotaTokens[10], platform: "ios" })).status, 409);
    await client("/api/client/push-token", tokenA, "DELETE", { token: quotaTokens[0] });
    assert.equal((await client("/api/client/push-token", tokenA, "POST", { token: quotaTokens[10], platform: "ios" })).status, 201);
    assert.equal((await client("/api/client/push-token", tokenA, "POST", { token: quotaTokens[0], platform: "ios" })).status, 409);
    await query("UPDATE carrier_portal_users SET status='suspended' WHERE id=$1", [a.id]);
    assert.equal((await client("/api/client/dashboard")).status, 401);
    await query("UPDATE carrier_portal_users SET status='active',password_hash=$2 WHERE id=$1", [a.id, await bcrypt.hash("Changed-fixture-password", 12)]);
    assert.equal((await client("/api/client/dashboard")).status, 401);

    const ip = `fixture-ip-${suffix}`;
    for (let i = 0; i < 3; i++) await consumeClientRegistrationAttempt(ip);
    await assert.rejects(consumeClientRegistrationAttempt(ip), /three registration attempts/);
    assert.ok((await query("SELECT ip_hash FROM client_registration_attempts WHERE ip_hash IS NOT NULL")).rows.every(r => /^[a-f0-9]{64}$/.test(r.ip_hash)));
    console.log("Verified client JWT and ownership boundaries, email activation/admin fallback, actual S3 upload, funding safety, private-note separation, outbox and rate limit. FCM was mocked; no email/push sent.");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    // Include intent keys from any failed upload while the transaction exists.
    const intents = await connection.query("SELECT s3_key FROM client_upload_intents WHERE portal_user_id IN (SELECT id FROM carrier_portal_users WHERE email LIKE $1)", [`%${suffix}%`]).catch(() => ({ rows: [] }));
    objectKeys.push(...intents.rows.map(r => r.s3_key));
    connectMock.mock.restore(); queryMock.mock.restore();
    await connection.query("ROLLBACK"); connection.release();
    for (const key of new Set(objectKeys)) await deleteFromS3Strict(key);
    await pool.end();
  }
});

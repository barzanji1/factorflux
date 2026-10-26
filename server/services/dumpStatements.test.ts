import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import {
  brokers, clients, invoices, cashApplications, paymentApplicationLines, brokerDumpStatements,
  brokerDumpStatementCursors, emailLog, eventLedger,
} from "../../shared/schema";
import { dumpStatementDueAt, isDumpLoad } from "../../shared/dump-statements";
import { processDumpStatements, recordDumpStatementSent, DUMP_STATEMENT_TEMPLATE } from "./dumpStatements";
import { renderDumpStatementPdf } from "./dumpStatementPdf";
import { createResendTransport, type ResendEmailParams } from "../resendTransport.js";
import { createEmailLogRecorder } from "./emailLogService";
import { reconcileEmailRetry, validateEmailRetryDomain } from "./emailLogReconciliation";
import { registerDumpStatementRoutes } from "../routes/dumpStatements";
import { confirmationSettingsSchema } from "../routes/brokerConfirmation";

const DAY = 86_400_000;
const at = new Date("2026-10-26T16:00:00Z");
after(() => pool.end());
test("funding-date intervals, exact boundary, missed-run coalescing and setting changes", () => {
  const funded = new Date(at.getTime() - 10 * DAY);
  assert.equal(dumpStatementDueAt(funded, 10, new Date(at.getTime() - 1)), null);
  assert.equal(dumpStatementDueAt(funded, 10, at)?.getTime(), at.getTime());
  assert.equal(dumpStatementDueAt(funded, 10, at, at), null);
  assert.equal(dumpStatementDueAt(funded, 10, new Date(at.getTime() + 10 * DAY), at)?.getTime(), at.getTime() + 10 * DAY);
  assert.equal(dumpStatementDueAt(funded, 10, new Date(at.getTime() + 25 * DAY))?.getTime(), at.getTime() + 20 * DAY);
  assert.equal(dumpStatementDueAt(funded, 7, new Date(at.getTime() + 11 * DAY), new Date(at.getTime() + 10 * DAY))?.getTime(), at.getTime() + 11 * DAY);
  assert.equal(isDumpLoad("dump"), true);
  assert.equal(isDumpLoad("dump_truck_ticket"), true);
  for (const type of ["otr_load", "hotshot", "other", null]) assert.equal(isDumpLoad(type), false);
  const settings = { maxReminders: 3, reminderDays: [3, 7, 14], publicBaseUrl: "https://factorflux.io" };
  for (const interval of [1, 10, 365]) assert(confirmationSettingsSchema.safeParse({ ...settings, dumpStatementIntervalDays: interval }).success);
  for (const interval of [0, 1.5, 366]) assert(!confirmationSettingsSchema.safeParse({ ...settings, dumpStatementIntervalDays: interval }).success);
});
test("TPF PDF repeats receipt branding/table headers and includes all rows across pages", async () => {
  const buffer = await renderDumpStatementPdf({
    id: randomUUID(), brokerName: "Isolated PDF verification broker", statementAt: at, totalBalance: "67500.00",
    invoiceSnapshot: Array.from({ length: 90 }, (_, index) => ({
      invoiceId: index + 1, invoiceNumber: `INV-PDF-${index + 1}`, loadNumber: `LOAD-${index + 1}`,
      carrier: "Isolated verification carrier", amount: "1000.00", balance: "750.00",
      fundedAt: new Date(at.getTime() - 10 * DAY).toISOString(),
    })),
  });
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  writeFileSync("/tmp/tpf-dump-statement-qa.pdf", buffer);
  const text = execFileSync("pdftotext", ["-layout", "/tmp/tpf-dump-statement-qa.pdf", "-"], { encoding: "utf8" });
  assert.match(text, /Trucking Pros Financial/);
  assert.match(text, /Total balance owed:.*67,500.00/);
  for (let index = 1; index <= 90; index++) assert(text.includes(`INV-PDF-${index}`));
  assert.doesNotMatch(text, /FactorFlux/);
  assert(text.split("\f").length > 2);
  assert.match(text, /Page 1 of/);
});
test("Preview cannot send real broker statements", async () => {
  if (process.env.NODE_ENV !== "production") assert.equal((await processDumpStatements()).blockedInPreview, true);
});
test("scheduled statements: scoped dump balances, duplicate protection, recurrence, failures, reconciliation and timeline (rollback)", async () => {
  const rollback = new Error("ROLLBACK_DUMP_STATEMENTS");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const [carrier] = await tx.insert(clients).values({ name: `Dump fixture ${tag}`, status: "new_client" }).returning();
    const makeBroker = async (name: string) => (await tx.insert(brokers).values({
      name: `${name} ${tag}`, email: "statements@example.test", contactPerson: "Fixture", phone: "000-000-0000", dataOrigin: "pilot",
    }).returning())[0];
    const broker = await makeBroker("Consolidated");
    const zero = await makeBroker("Zero balance");
    const retry = await makeBroker("Retry");
    const uncertain = await makeBroker("Uncertain");
    const cancelled = await makeBroker("Paid before retry");
    const make = async (brokerId: number, name: string, days = 10, overrides: Partial<typeof invoices.$inferInsert> = {}) =>
      (await tx.insert(invoices).values({
        invoiceNumber: `${name}-${randomUUID()}`, loadNumber: `LOAD-${name}`, loadId: null, clientId: carrier.id,
        brokerId, amount: "1000", status: "funded", loadType: "dump_truck_ticket",
        fundedAt: new Date(at.getTime() - days * DAY), ...overrides,
      }).returning())[0];
    const pay = async (invoice: typeof invoices.$inferSelect, amount: string, writeoff = "0") => {
      const [cash] = await tx.insert(cashApplications).values({
        paymentReference: randomUUID(), payorName: "Fixture", paymentDate: at, totalReceived: amount,
      }).returning();
      await tx.insert(paymentApplicationLines).values({
        cashApplicationId: cash.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceAmount: invoice.amount,
        appliedAmount: amount, variance: writeoff, varianceType: writeoff === "0" ? "short_pay" : "write_off",
      });
    };
    const a = await make(broker.id, "A");
    const b = await make(broker.id, "B", 20, { amount: "2000" });
    const young = await make(broker.id, "YOUNG", 2, { amount: "300" });
    const legacy = await make(broker.id, "LEGACY", 10, { amount: "50" });
    await pay(a, "250"); await pay(b, "500"); await pay(b, "500");
    const paid = await make(broker.id, "PAID", 10, { amount: "100" }); await pay(paid, "100");
    const writtenOff = await make(broker.id, "WRITTEN-OFF", 10, { amount: "100" }); await pay(writtenOff, "70", "30");
    await make(broker.id, "OTR", 30, { loadType: "otr_load" });
    await make(broker.id, "HOTSHOT", 30, { loadType: "hotshot" });
    await make(broker.id, "SETTLED", 30, { status: "settled" });
    await make(broker.id, "UNFUNDED", 10, { fundedAt: null });
    const fullyPaid = await make(zero.id, "ZERO", 20); await pay(fullyPaid, "1000");
    const objects = new Map<string, Buffer>();
    const requests: { key: string; body: Record<string, any> }[] = [];
    let mode: "ok" | "reject" | "uncertain" = "ok";
    const transport = createResendTransport(async (_connector, _path, request) => {
      requests.push({ key: request.headers["Idempotency-Key"], body: request.body as Record<string, any> });
      if (mode === "uncertain") throw new Error("Simulated transport timeout");
      return new Response(JSON.stringify(mode === "reject" ? { message: "Rate limited" } : { id: `msg-${randomUUID()}` }),
        { status: mode === "reject" ? 429 : 200 });
    }, 1000, createEmailLogRecorder({ store: tx, upload: async () => "mock-tpf-logo", now: () => at }));
    let lastParams: ResendEmailParams | undefined;
    const send = async (params: ResendEmailParams) => { lastParams = params; return transport(params); };
    const base = { store: tx, now: () => at, send, sleep: async () => {},
      upload: async (buffer: Buffer, key: string) => { objects.set(key, buffer); return key; },
      download: async (key: string) => { const buffer = objects.get(key); if (!buffer) throw Error("Missing fixture PDF"); return buffer; } };
    const first = await processDumpStatements({ ...base, brokerIds: [broker.id, zero.id] });
    assert.equal(first.sent, 1, JSON.stringify(first)); assert.equal(first.failed, 0);
    let [job] = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.brokerId, broker.id));
    assert.equal(job.totalBalance, "2100.00");
    assert.equal(job.invoiceSnapshot.length, 4);
    assert(job.invoiceSnapshot.some(row => row.invoiceId === young.id));
    assert.equal(job.triggers.length, 3);
    assert.equal(job.status, "sent");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.to, ["statements@example.test"]);
    assert.match(requests[0].body.html, /data-tpf-email="1"/);
    const pdfAttachment = requests[0].body.attachments.find((entry: any) => entry.filename.startsWith("TPF_Dump_Statement"));
    assert.equal(Buffer.from(pdfAttachment.content, "base64").subarray(0, 4).toString(), "%PDF");
    const [log] = await tx.select().from(emailLog).where(and(eq(emailLog.templateName, DUMP_STATEMENT_TEMPLATE), eq(emailLog.entityId, String(broker.id))));
    assert.equal(log.status, "sent");
    assert.equal(log.entityType, "broker");
    assert((log.attachments as { s3_key: string }[]).some(item => item.s3_key === job.s3Key));
    assert.equal((await processDumpStatements({ ...base, brokerIds: [broker.id] })).sent, 0);
    assert.equal(requests.length, 1);
    await pay(a, "750");
    assert.equal((await processDumpStatements({ ...base, now: () => new Date(at.getTime() + 10 * DAY), brokerIds: [broker.id] })).sent, 1);
    const jobs = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.brokerId, broker.id));
    assert.equal(jobs.length, 2);
    assert(jobs.some(row => row.totalBalance === "1350.00"));
    assert.equal((await processDumpStatements({ ...base, now: () => new Date(at.getTime() + 10 * DAY), brokerIds: [broker.id] })).sent, 0);
    await make(retry.id, "RETRY");
    mode = "reject";
    assert.equal((await processDumpStatements({ ...base, brokerIds: [retry.id] })).failed, 1);
    const rejectedKey = requests.at(-1)!.key;
    mode = "ok";
    assert.equal((await processDumpStatements({ ...base, brokerIds: [retry.id] })).sent, 1);
    assert.equal(requests.at(-1)!.key, rejectedKey);
    await make(uncertain.id, "UNCERTAIN");
    mode = "uncertain";
    assert.equal((await processDumpStatements({ ...base, brokerIds: [uncertain.id] })).failed, 1);
    const count = requests.length;
    assert.equal((await processDumpStatements({ ...base, brokerIds: [uncertain.id] })).sent, 0);
    assert.equal(requests.length, count);
    const params = lastParams!;
    await assert.rejects(validateEmailRetryDomain(params, tx), /Dump statements are retried by the aging job/);
    await reconcileEmailRetry(params, "verified-late-acceptance", null, tx, at);
    await recordDumpStatementSent(params.emailLog!.dumpStatementId!, "verified-late-acceptance", tx, at);
    const [repaired] = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.id, params.emailLog!.dumpStatementId!));
    assert.equal(repaired.status, "sent");
    const sentEvents = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "broker"), eq(eventLedger.entityId, uncertain.id), eq(eventLedger.eventType, "broker_dump_statement_sent")));
    assert.equal(sentEvents.length, 1);
    const cancelInvoice = await make(cancelled.id, "CANCEL");
    mode = "ok";
    const noSendCount = requests.length;
    const failedUpload = await processDumpStatements({ ...base, brokerIds: [cancelled.id], upload: async () => { throw Error("Simulated S3 denial"); } });
    assert.equal(failedUpload.failed, 1);
    await pay(cancelInvoice, "1000");
    assert.equal((await processDumpStatements({ ...base, brokerIds: [cancelled.id] })).sent, 0);
    assert.equal(requests.length, noSendCount);
    const [cancelJob] = await tx.select().from(brokerDumpStatements).where(eq(brokerDumpStatements.brokerId, cancelled.id));
    assert.equal(cancelJob.status, "skipped");
    const cursors = await tx.select().from(brokerDumpStatementCursors).where(eq(brokerDumpStatementCursors.invoiceId, cancelInvoice.id));
    assert.equal(cursors[0].activeStatementId, null);
    const app = express();
    registerDumpStatementRoutes(app, (req, res, next) => {
      if (!req.headers["x-fixture"]) { res.status(401).json({ message: "Login required" }); return; } next();
    }, tx, async () => "https://example.test/statement.pdf");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const history = `/api/brokers/${broker.id}/statement-history`;
      assert.equal((await fetch(root + history)).status, 401);
      const response = await fetch(root + history, { headers: { "x-fixture": "yes" } });
      const events = await response.json() as any[];
      assert.equal(response.status, 200); assert.equal(events.length, 2);
      const download = await fetch(root + events[0].downloadUrl, { headers: { "x-fixture": "yes" }, redirect: "manual" });
      assert.equal(download.status, 302);
      assert.equal(download.headers.get("location"), "https://example.test/statement.pdf");
      assert.equal((await fetch(`${root}/api/brokers/${zero.id}/dump-statements/${job.id}/download`, { headers: { "x-fixture": "yes" } })).status, 404);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    throw rollback;
  }), error => error === rollback);
});

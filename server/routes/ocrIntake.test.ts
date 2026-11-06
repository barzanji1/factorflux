import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import * as ocrPipelineTiming from "../services/ocrPipelineTiming";
import * as documentTypeHints from "../services/documentTypeHints";
import ts from "typescript";
import express from "express";
import multer from "multer";
import { documents, docExtractionJobs, docFieldCandidates } from "../../shared/schema";
import { IntakeError, mapIntakeDocuments } from "../services/ocrIntakeMapping";

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const state = {
    doc: { id: 1, uploadedBy: "owner" }, failTransaction: false,
    job: { id: 2, status: "completed", errorMessage: null as string | null },
    fields: [
      { fieldName: "broker_name", normalizedValue: "Raw Broker LLC" },
      { fieldName: "broker_id", normalizedValue: "999" },
    ],
    match: { brokerId: 42 as number | null, confidence: "medium" as string | null,
      rawName: "Raw Broker LLC", matchedName: "Existing Broker", candidates: [{ id: 42, name: "Existing Broker" }] },
    uploads: [] as string[], cleanup: [] as string[], queued: [] as unknown[], inserted: [] as unknown[],
    pendingDoc: null as any, pendingJob: null as any,
  };
  const database = {
    select: () => {
      let table: unknown;
      const chain = {
        from: (value: unknown) => { table = value; return chain; },
        where: () => chain, orderBy: () => chain, limit: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(
          table === documents ? [state.doc] : table === docExtractionJobs ? [state.job] : state.fields).then(resolve),
      };
      return chain;
    },
    transaction: async (fn: (tx: unknown) => unknown) => {
      if (state.failTransaction) throw new Error("Fixture insert failure");
      return fn({ execute: async () => {}, select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          where: () => chain, orderBy: () => chain,
          limit: async () => {
            const value = table === documents ? state.pendingDoc : state.pendingJob;
            return value ? [value] : [];
          },
        };
        return chain;
      }, insert: (table: unknown) => ({ values: (data: unknown) => {
        state.inserted.push(data);
        const row = { ...(data as object), id: table === documents ? 1 : 2 };
        if (table === documents) state.pendingDoc = row; else state.pendingJob = row;
        return { returning: async () => [row] };
      } }) });
    },
  };
  const code = ts.transpileModule(fs.readFileSync("server/routes/ocrIntake.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, Function> = {};
  vm.runInNewContext(code, {
    exports, Buffer, console: { error() {} },
    require: (name: string) => {
      if (name.endsWith("ocrPipelineTiming")) return ocrPipelineTiming;
      if (name.endsWith("documentTypeHints")) return documentTypeHints;
      if (name === "../db") return { db: database };
      if (name === "../../shared/schema") return { documents, docExtractionJobs, docFieldCandidates };
      if (name === "drizzle-orm") return { eq() {}, desc() {}, asc() {}, and() {}, isNull() {}, sql() {} };
      if (name === "node:crypto") return { randomUUID: () => "fixture-key", createHash };
      if (name === "node:fs/promises") return { writeFile: async () => {}, unlink: async () => {} };
      if (name.endsWith("s3Service")) return { uploadDocumentToS3: async (_file: unknown, key: string) => { state.uploads.push(key); return key; } };
      if (name.endsWith("documentCompression")) return { documentSizeMetadata: (file: any) => ({ originalSize: file.size, compressedSize: file.size }) };
      if (name.endsWith("jobQueue")) return { jobQueue: { enqueue: (job: unknown) => state.queued.push(job) } };
      if (name.endsWith("ocrBrokerMatching")) return { findOcrBrokerMatch: async (raw: unknown) => raw ? state.match : {
        brokerId: null, confidence: null, rawName: null, matchedName: null, candidates: [],
      } };
      if (name.endsWith("ocrIntakeMapping")) return { IntakeError, mapIntakeDocuments };
      if (name.endsWith("ocrIntakeSnapshot")) return { parseIntakeIds: (ids: number[]) => ids,
        getIntakeSnapshot: async (_ids: number[], user: { id: string }) => {
          if (user.id !== state.doc.uploadedBy) throw new IntakeError("Not your document", 403);
          return { status: state.job.status, fields: state.fields, sources: {}, documents: [], alerts: [] };
        } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const app = express();
  exports.registerOcrIntakeRoutes(app, (req: any, res: any, next: Function) => {
    if (!req.headers["x-fixture-user"]) return res.sendStatus(401);
    req.user = { id: req.headers["x-fixture-user"], role: "employee" }; next();
  }, multer({ storage: multer.memoryStorage() }).single("file"),
  async (key: string) => { state.cleanup.push(key); return true; });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const upload = async (valid = true) => {
    const form = new FormData();
    form.append("file", new Blob([valid ? "%PDF-1.4\nfixture" : "bad content"], { type: "application/pdf" }), "invoice.pdf");
    return fetch(`${base}/api/invoices/ocr-intake`, { method: "POST", headers: { "x-fixture-user": "owner" }, body: form });
  };
  return { state, base, upload };
}

test("OCR intake queues only valid PDFs and uses explicit NULL associations", async t => {
  const { state, upload } = await setup(t);
  assert.equal((await upload(false)).status, 400);
  assert.equal(state.uploads.length, 0);
  assert.equal((await upload()).status, 201);
  assert.equal(state.queued.length, 1);
  assert.equal(state.inserted.length, 2);
  const doc = state.inserted[0] as Record<string, unknown>;
  for (const key of ["clientId", "loadId", "invoiceId", "companyId"]) assert.equal(doc[key], null);
  assert.equal(doc.documentType, "other");
});
test("transaction failure compensates only the new S3 object and never queues", async t => {
  const { state, upload } = await setup(t);
  state.failTransaction = true;
  assert.equal((await upload()).status, 500);
  assert.deepEqual(state.cleanup, ["documents/fixture-key"]);
  assert.equal(state.queued.length, 0);
});
test("upload retry reuses its pending document and job, removes the redundant S3 copy", async t => {
  const { state, upload } = await setup(t);
  const first = await (await upload()).json();
  const second = await (await upload()).json();
  assert.equal(first.documents[0].documentId, second.documents[0].documentId);
  assert.equal(state.inserted.length, 2, "one document and one job, not another document");
  assert.equal(state.queued.length, 1);
  assert.equal(state.pendingDoc.uploadedBy, "owner");
  assert.equal(state.pendingDoc.sourceSha256.length, 64);
  assert.equal(state.cleanup.length, 1);
});
test("reupload of a previously misclassified filename document requeues OCR on the same row", async t => {
  const { state, upload } = await setup(t);
  await upload();
  state.pendingDoc.originalName = "LUMPER-0556271.pdf";
  state.pendingDoc.aiDocumentType = "other";
  state.pendingJob.status = "completed";
  await upload();
  assert.equal(state.inserted.length, 3, "one document and two jobs");
  assert.equal(state.queued.length, 2);
});
test("reupload of failed OCR retries a job on the same document", async t => {
  const { state, upload } = await setup(t);
  await upload();
  state.pendingJob.status = "failed";
  await upload();
  assert.equal(state.inserted.length, 3, "one document and two attempts");
  assert.equal(state.queued.length, 2);
});
test("OCR status requires authentication and document ownership", async t => {
  const { base } = await setup(t);
  assert.equal((await fetch(`${base}/api/invoices/ocr-intake/1`)).status, 401);
  assert.equal((await fetch(`${base}/api/invoices/ocr-intake/1`, { headers: { "x-fixture-user": "other" } })).status, 403);
});
test("status preselects current match and removes stale IDs for ambiguous matches", async t => {
  const { base, state } = await setup(t);
  const get = async () => (await fetch(`${base}/api/invoices/ocr-intake/1`,
    { headers: { "x-fixture-user": "owner" } })).json();
  const selected = await get();
  assert.equal(selected.fields.broker_id, "42");
  assert.equal(selected.fields.broker_match_confidence, "medium");
  state.match.brokerId = null;
  state.match.confidence = null;
  const ambiguous = await get();
  assert.equal(ambiguous.fields.broker_id, undefined);
  assert.equal(ambiguous.fields.broker_name, "Raw Broker LLC");
});
test("failed provider status exposes stored error, not partial field candidates", async t => {
  const { base, state } = await setup(t);
  state.job.status = "failed"; state.job.errorMessage = "Fixture provider denied";
  const result = await (await fetch(`${base}/api/invoices/ocr-intake/1`,
    { headers: { "x-fixture-user": "owner" } })).json();
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Fixture provider denied");
  assert.deepEqual(result.fields, {});
});

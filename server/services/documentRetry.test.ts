import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { documents, docExtractionJobs } from "../../shared/schema";

// Exercise the actual route handler with isolated DB/auth/file/queue boundaries.
const source = ts.createSourceFile("routes.ts", readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
let handler: ts.Node | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "post" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "/api/load-documents/:id/retry-extraction") {
    handler = node.arguments.at(-1);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const compiled = ts.transpileModule(`const handler = ${handler.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function fixture({ access = true, fileExists = true, insertFails = false } = {}) {
  const document = { id: 101, invoiceId: 901, status: "failed", filename: "fixture.pdf", mimeType: "application/pdf" };
  const jobs: unknown[] = [], enqueued: unknown[] = [];
  const database: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [document] }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => {
      if (document.status !== "failed") return [];
      document.status = "processing"; return [{ id: document.id }];
    } }) }) }),
    insert: () => ({ values: (values: unknown) => ({ returning: async () => {
      if (insertFails) throw new Error("Insert failed");
      jobs.push(values); return [{ id: 203 }];
    } }) }),
    transaction: async (callback: (transaction: any) => unknown) => {
      const previous = document.status;
      try { return await callback(database); } catch (error) { document.status = previous; throw error; }
    },
  };
  const run = vm.runInNewContext(`${compiled}; handler`, {
    db: database, documentsTable: documents, docExtractionJobs, eq, and, path,
    fs: { existsSync: () => fileExists }, employeeCanAccessInvoice: async () => access,
    downloadToTemp: async () => {}, jobQueue: { enqueue: (job: unknown) => enqueued.push(job) },
  });
  const request = async (role = "admin") => {
    let code = 200, body: any;
    const response: any = { status: (value: number) => { code = value; return response; },
      json: (value: unknown) => { body = value; return response; } };
    await run({ params: { id: "101" }, user: { role } }, response);
    return { code, body };
  };
  return { request, document, jobs, enqueued };
}

test("Retry atomically creates one queued OCR job and prevents duplicate clicks", async () => {
  const f = fixture();
  assert.equal((await f.request()).body.status, "queued");
  assert.equal(f.document.status, "processing");
  assert.equal(f.jobs.length, 1);
  assert.equal((f.jobs[0] as { jobType: string }).jobType, "ocr");
  assert.equal(f.enqueued.length, 1);
  assert.equal((await f.request()).code, 409);
  assert.equal(f.jobs.length, 1);
});
test("Retry denies an employee without invoice access", async () => {
  const f = fixture({ access: false });
  assert.equal((await f.request("employee")).code, 403);
  assert.equal(f.document.status, "failed");
  assert.equal(f.jobs.length, 0);
});
test("Retry retains failed status when the original file is missing", async () => {
  const f = fixture({ fileExists: false });
  assert.equal((await f.request()).code, 404);
  assert.equal(f.document.status, "failed");
  assert.equal(f.jobs.length, 0);
});
test("Retry transaction rolls back the processing claim if job creation fails", async () => {
  const f = fixture({ insertFails: true });
  assert.equal((await f.request()).code, 500);
  assert.equal(f.document.status, "failed");
  assert.equal(f.enqueued.length, 0);
});

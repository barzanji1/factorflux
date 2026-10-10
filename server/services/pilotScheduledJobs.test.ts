import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { and, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { brokers } from "../../shared/schema";

const dialect = new PgDialect();
function source(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}
function find(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(root);
  assert(found, "Expected production declaration");
  return found;
}
function compile(code: string, context: Record<string, unknown>) {
  return vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
function captureDb() {
  let filter: any;
  return {
    get query() { return dialect.sqlToQuery(sql`select ${brokers.id} from ${brokers}${filter ? sql` where ${filter}` : sql``}`); },
    db: { select: () => ({ from: () => ({ where: async (value: unknown) => { filter = value; return []; } }) }) },
  };
}
const creditSource = source("server/services/brokerCreditEngine.ts");
const authoritySource = source("server/services/authorityScheduler.ts");
test("scheduled credit selection excludes only pilot, retaining NULL and other origins; manual includes all", async () => {
  const fn = find(creditSource, node => ts.isFunctionDeclaration(node) && node.name?.text === "recalculateAllBrokerCredit");
  for (const scheduled of [true, false]) {
    const capture = captureDb();
    const run = compile(`(${fn.getText(creditSource).replace(/^export /, "")})`, {
      db: capture.db, brokers, sql, recalculateBrokerCreditBatch: async (ids: number[]) => ids,
    });
    await run(scheduled ? { scheduled: true } : undefined);
    assert.equal(capture.query.sql.includes("IS DISTINCT FROM"), scheduled);
    assert.deepEqual(capture.query.params, scheduled ? ["pilot"] : []);
    if (scheduled) assert(!capture.query.sql.includes(" <> "), "NULL origins must not be silently excluded");
  }
});
test("FMCSA selection filters pilot only for the existing scheduled system trigger", async () => {
  const decl = find(authoritySource, node => ts.isVariableDeclaration(node) && node.name.getText() === "allBrokers") as ts.VariableDeclaration;
  for (const triggeredBy of ["system", "admin-1"]) {
    const capture = captureDb();
    const run = compile(`(async () => ${decl.initializer!.getText(authoritySource)})`, {
      db: capture.db, brokers, sql, and, eq, triggeredBy,
    });
    await run();
    const scheduled = triggeredBy === "system";
    assert.equal(capture.query.sql.includes("IS DISTINCT FROM"), scheduled);
    assert.deepEqual(capture.query.params, scheduled ? ["active", "pilot"] : ["active"]);
  }
});
test("credit cron passes scheduled eligibility while retaining advisory lock ownership", async () => {
  const fn = find(creditSource, node => ts.isFunctionDeclaration(node) && node.name?.text === "startBrokerCreditScheduler");
  let callback: (() => Promise<void>) | undefined, options: unknown;
  const locks: string[] = [];
  const cron = { validate: () => true, schedule: (_expression: string, handler: () => Promise<void>) => { callback = handler; } };
  const start = compile(`(${fn.getText(creditSource).replace(/^export /, "")})`, {
    schedulerStarted: false, running: false,
    process: { env: {} }, console: { log: () => {}, warn: () => {}, error: () => {} },
    require: () => ({ default: cron }),
    pool: { connect: async () => ({
      query: async (statement: string) => { locks.push(statement); return { rows: [{ acquired: true }] }; }, release: () => {},
    }) },
    recalculateAllBrokerCredit: async (value: unknown) => { options = value; },
  });
  start();
  await new Promise(resolve => setImmediate(resolve));
  assert(callback);
  await callback();
  assert.equal((options as { scheduled: boolean }).scheduled, true);
  assert.equal(locks.length, 2);
  assert.match(locks[0], /pg_try_advisory_lock/);
  assert.match(locks[1], /pg_advisory_unlock/);
});
test("manual bulk routes and single-entity credit selection keep existing behavior", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  assert.match(routes, /await recalculateAllBrokerCredit\(\)/);
  assert.match(routes, /await runAllAuthorityChecks\(req\.user\.id\)/);
  const fn = find(creditSource, node => ts.isFunctionDeclaration(node) && node.name?.text === "recalculateBrokerCredit");
  assert(!fn.getText(creditSource).includes("dataOrigin"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
// Exercise the actual route decision/audit helpers without creating real financial
// records. They are nested in registration; extract their AST, not a reimplementation.
function helpers() {
  const source = ts.createSourceFile("routes.ts", readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const names = ["getPreflightDecision", "recordInvoicePreflight"];
  const declarations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text) && node.initializer) {
      declarations.push(`const ${node.name.text} = ${node.initializer.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.length, 2);
  const writes: any[] = [], ledger: any[] = [];
  const database = {
    execute: async (query: any) => { writes.push(query); },
    insert: (_table: any) => ({ values: async (row: any) => { ledger.push(row); } }),
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(`${declarations.join("\n")}\nObject.assign(exports,{${names.join(",")}});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, z, db: database, eventLedger: "event_ledger",
    sql: (strings: TemplateStringsArray, ...values: any[]) => ({ sql: strings.join("?"), values }),
    isPrivilegedUser: () => false,
  });
  return { ...exports, writes, ledger, database };
}
const alert = { code: "BOL_MISMATCH", severity: "ack", title: "Wrong BOL",
  message: "rate.pdf vs bol.pdf: origin and shipment reference differ." };
test("server rejects BOL_MISMATCH without its acknowledgement, even with no other block alerts", () => {
  const { getPreflightDecision } = helpers();
  const missing = getPreflightDecision([alert], [], { id: "staff" }, false);
  assert.equal(missing.accepted, false);
  assert.equal(missing.missingAckCodes[0], "BOL_MISMATCH");
  assert.equal(getPreflightDecision([alert], [{ code: "BOL_MISMATCH", reason: "Reviewed paperwork" }], {}, false).accepted, true);
  assert.equal(getPreflightDecision([alert], [{ code: "LOAD_MISMATCH" }], {}, false).accepted, false);
});
test("acknowledgement records code, actor, reason and detailed alert in transaction/audit ledger", async () => {
  const { recordInvoicePreflight, writes, ledger, database } = helpers();
  const acks = [{ code: "BOL_MISMATCH", reason: "Reviewed replacement paperwork" }];
  await recordInvoicePreflight(100, "staff", [alert], acks, false, database);
  assert(writes[0].sql.includes("invoice_alert_acks"));
  assert.deepEqual(writes[0].values, [100, "BOL_MISMATCH", "staff", "Reviewed replacement paperwork"]);
  assert.equal(ledger[0].eventType, "invoice_preflight");
  assert.equal(ledger[0].actorId, "staff");
  assert.equal(ledger[0].payloadJson.alerts[0].message, alert.message);
  assert.equal(ledger[0].payloadJson.acknowledgements[0].code, "BOL_MISMATCH");
});

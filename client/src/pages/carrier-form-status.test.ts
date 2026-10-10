import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { insertClientSchema } from "../../../shared/schema";

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function initializer(file: ts.SourceFile, name: string) {
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert(found, `Missing ${name}`);
  return found.getText(file);
}
function evaluate(expression: string, context: Record<string, unknown> = {}) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
const carrier = parse("client/src/pages/carrier-onboarding.tsx");
const broker = parse("client/src/pages/brokers.tsx");
test("carrier defaults survive generated blank section fields", () => {
  const sections = evaluate(initializer(carrier, "sections"));
  assert(sections.some((section: { fields: string[] }) => section.fields.includes("status")));
  const defaults = evaluate(initializer(carrier, "defaults"), { sections, initialOwners: () => [] });
  assert.equal(defaults.status, "new_client");
  assert.equal(defaults.language, "English");
});
test("carrier and broker schemas reject empty status, retain valid edits and default missing values", () => {
  for (const [file, name, defaultStatus, statuses] of [
    [carrier, "formSchema", "new_client", ["new_client", "active", "inactive"]],
    [broker, "brokerFormSchema", "active", ["active", "inactive", "suspended"]],
  ] as const) {
    const schema = evaluate(initializer(file, name), { z }).shape.status;
    assert.equal(schema.parse(undefined), defaultStatus);
    assert.equal(schema.safeParse("").success, false);
    for (const status of statuses) assert.equal(schema.parse(status), status);
  }
  assert.equal(insertClientSchema.shape.status.safeParse("").success, false);
});
test("status selects normalize empty change events and legacy carrier create/reset uses new_client", () => {
  for (const [path, fallback] of [
    ["client/src/components/modals/client-modal.tsx", "new_client"],
    ["client/src/pages/brokers.tsx", "active"],
  ]) {
    const file = parse(path);
    let statusField: ts.JsxSelfClosingElement | undefined;
    function findStatus(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "FormField" &&
          node.attributes.properties.some(attribute =>
            ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "name" &&
            attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "status")) {
        statusField = node;
      }
      ts.forEachChild(node, findStatus);
    }
    findStatus(file);
    assert(statusField, "Expected the status FormField, not another select");
    let callback: ts.Expression | undefined;
    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(file) === "onValueChange" &&
          node.initializer && ts.isJsxExpression(node.initializer) &&
          node.initializer.expression?.getText(file).includes(`value || "${fallback}"`)) {
        callback = node.initializer.expression;
      }
      ts.forEachChild(node, visit);
    }
    visit(statusField);
    assert(callback);
    let submitted: string | undefined;
    const change = evaluate(callback.getText(file), { field: { onChange: (value: string) => { submitted = value; } } });
    change("");
    assert.equal(submitted, fallback);
    change("inactive");
    assert.equal(submitted, "inactive");
  }
  const modal = readFileSync("client/src/components/modals/client-modal.tsx", "utf8");
  assert.equal((modal.match(/status: "new_client"/g) ?? []).length, 2);
  assert(modal.includes('SelectItem value="new_client"'));
  const source = readFileSync("client/src/pages/brokers.tsx", "utf8");
  assert.equal((source.match(/status: "active"/g) ?? []).length, 2);
});

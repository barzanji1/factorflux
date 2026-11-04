import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const removed = [
  "components/layout/Topbar.tsx",
  "components/win95/index.tsx",
  "components/dashboard/cutoff-times.tsx",
  "components/dashboard/document-upload.tsx",
  "components/dashboard/quick-actions.tsx",
  "components/dashboard/recent-activity.tsx",
  "components/dashboard/recent-invoices.tsx",
  "components/dashboard/stats-cards.tsx",
  "components/dashboard/SystemHealthCard.tsx",
  "pages/form-demo.tsx",
];
const root = path.resolve("client/src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
  });
}

test("removed legacy files are absent and have no active source imports", () => {
  const deleted = new Set(removed.map(file => path.join(root, file)));
  for (const file of deleted) assert.equal(existsSync(file), false, `${file} still exists`);
  for (const file of sources(root)) {
    const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0];
      if (specifier && ts.isStringLiteral(specifier)) {
        const value = specifier.text;
        const base = value.startsWith("@/") ? path.join(root, value.slice(2)) :
          value.startsWith(".") ? path.resolve(path.dirname(file), value) : undefined;
        if (base) for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]) {
          assert.equal(deleted.has(candidate), false, `${file} imports deleted ${value}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
});

test("unused form demo is removed but legacy support links still resolve", () => {
  const app = readFileSync(path.join(root, "App.tsx"), "utf8");
  assert.doesNotMatch(app, /FormDemo|\/form-demo/);
  assert.match(app, /path="\/tickets\/:id"/);
  assert.match(app, /<LegacyTicketRedirect\s*\/>/);
  const redirect = readFileSync(path.join(root, "pages/legacy-ticket-redirect.tsx"), "utf8");
  assert.match(redirect, /\/api\/it-support\/legacy/);
  assert.match(redirect, /\/it-support\?requestId=/);
  assert.match(redirect, /NeuPageShell/);
  assert.doesNotMatch(redirect, /components\/win95|bg-win95|shadow-bevel/);
});

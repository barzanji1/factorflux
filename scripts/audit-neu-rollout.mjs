import ts from "typescript";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = "client/src", out = "generated-artifacts/neu-rollout";
async function list(dir) {
  const files = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(files.map(file => file.isDirectory() ? list(path.join(dir,file.name)) : file.name.endsWith(".tsx") ? [path.join(dir,file.name)] : []))).flat();
}
function scan(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [], legacyAliases = new Set(), raw = [], overrides = [], oldTheme = [];
  for (const node of tree.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const from = node.moduleSpecifier.text;
    const names = node.importClause?.namedBindings;
    if (!names || !ts.isNamedImports(names)) continue;
    for (const item of names.elements) {
      const original = (item.propertyName ?? item.name).text, local = item.name.text;
      if (/^(Button|Card|Table|Input|Select|Badge|Tabs|Textarea)/.test(original) && !from.includes("/styles/neu")) {
        imports.push({ from, original, local });
        if (/\/ui\/(?:button|card|table|input|badge|tabs|textarea)$/.test(from)) legacyAliases.add(local);
      }
    }
  }
  let legacyNodes = 0, neuNodes = 0;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree), line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      if (/^(button|input|select|textarea|table)$/.test(tag)) { raw.push({ line, tag }); legacyNodes++; }
      else if (legacyAliases.has(tag)) legacyNodes++;
      if (/^Neu[A-Z]/.test(tag)) neuNodes++;
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(tree) !== "className" || !attribute.initializer) continue;
        const value = attribute.initializer.getText(tree);
        if (/\b(?:rounded-|bg-|shadow-|border-)/.test(value)) overrides.push(line);
        if (/\b(?:win95|windows95|retro[-_]|ff-(?:window|titlebar|inset|bevel))/.test(value)) oldTheme.push(line);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { file, legacyNodes, neuNodes, raw, imports, potentialOverrideLines: [...new Set(overrides)], legacyThemeLines: [...new Set(oldTheme)] };
}
const changed = new Set(execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().split("\n"));
const findings = [];
let replaced = 0, rawButtonsReplaced = 0;
for (const file of await list(root)) {
  const now = scan(file, await readFile(file,"utf8"));
  if (changed.has(file)) {
    let before = "";
    try { before = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }); } catch {}
    const previous = scan(file,before);
    replaced += Math.max(0, previous.legacyNodes-now.legacyNodes);
    rawButtonsReplaced += Math.max(0, previous.raw.filter(item => item.tag==="button").length-now.raw.filter(item=>item.tag==="button").length);
  }
  findings.push(now);
}
await mkdir(out,{recursive:true});
const trackedChanged = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const added = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const summary = { tsxFilesScanned:findings.length, filesChanged:new Set([...trackedChanged,...added]).size,
  legacyJsxUsagesReplaced:replaced, rawButtonsReplaced, remainingRawButtons:findings.reduce((sum,f)=>sum+f.raw.filter(r=>r.tag==="button").length,0),
  definition:"Before/after AST count of native button/input/select/textarea/table and direct legacy UI control usages in changed files. Shared CSS effects are not inflated into per-instance counts." };
await writeFile(`${out}/audit.json`,JSON.stringify({summary,findings},null,2));
const rows = findings.filter(f=>f.raw.length||f.imports.length||f.legacyThemeLines.length||f.potentialOverrideLines.length);
const md = `# Neumorphic rollout audit\n\n${JSON.stringify(summary,null,2)}\n\n`+
  `## Scope and interpretation\n\nNative elements inside design primitives and the custom login are intentional. Radix-compatible Funding/Risk/Recovery/Admin adapters retain API names but render neumorphic controls. Utility-class matches are potential conflicts, not proof of legacy appearance. Public customer pages and non-requested pages are listed rather than silently restyled. Full line-level findings are in audit.json.\n\n`+
  `| File | Native controls | Non-Neu control imports | Win95/retro lines | Potential utility overrides |\n|---|---:|---:|---|---:|\n`+
  rows.map(f=>`| \`${f.file}\` | ${f.raw.length} | ${f.imports.length} | ${f.legacyThemeLines.join(", ")||"—"} | ${f.potentialOverrideLines.length} |`).join("\n");
await writeFile(`${out}/audit.md`,md+"\n");
console.log(JSON.stringify(summary));

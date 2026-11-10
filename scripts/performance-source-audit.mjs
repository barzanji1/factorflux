import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const ignored = new Set(["node_modules", ".git", "dist", "electron-dist", "generated-artifacts", ".local", ".agents", "attached_assets"]);
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
  const file = path.join(dir, item.name);
  if (ignored.has(item.name)) return [];
  return item.isDirectory() ? walk(file) : /\.[cm]?[jt]sx?$|\.css$/.test(file) ? [file] : [];
});
let files = ["client/src", "server", "shared", "scripts", "electron", "artifacts"].filter(fs.existsSync).flatMap(walk);
files.push(...fs.readdirSync(root).filter(name => /\.[cm]?[jt]s$/.test(name)).map(name => path.join(root, name)));
files = files.map(file => path.resolve(file));
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const graph = new Map(), packages = new Set(), incoming = new Map();
function packageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/") || specifier.startsWith("@shared/") || specifier.startsWith("@assets/") || specifier.startsWith("node:")) return;
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}
function resolve(from, specifier) {
  const artifact = path.relative(root, from).match(/^artifacts\/([^/]+)\//);
  if (artifact && specifier.startsWith("@/")) {
    const base = path.join(root, "artifacts", artifact[1], "src", specifier.slice(2));
    return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
      .find(file => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
  }
  const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule?.resolvedFileName;
  if (resolved && !resolved.includes("/node_modules/")) return path.resolve(resolved);
  let base = specifier.startsWith("@/") ? path.join(root, "client/src", specifier.slice(2))
    : specifier.startsWith("@shared/") ? path.join(root, "shared", specifier.slice(8))
      : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
    .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
}
for (const file of files) {
  const source = fs.readFileSync(file, "utf8"), edges = [];
  const link = specifier => {
    const pkg = packageName(specifier);
    if (pkg && !file.includes("/artifacts/")) packages.add(pkg);
    const target = resolve(file, specifier);
    if (target) {
      edges.push(target);
      incoming.set(target, [...(incoming.get(target) ?? []), file]);
    }
  };
  if (file.endsWith(".css")) {
    for (const match of source.matchAll(/@import\s+(?:url\()?["']([^"']+)/g)) link(match[1]);
  } else {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) link(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) link(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  graph.set(path.resolve(file), edges);
}
const reachable = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
}
visit(path.resolve("client/src/main.tsx"));
const clientUnused = files.filter(file => file.includes("/client/src/") && !reachable.has(file) && !/\.(test|spec)\./.test(file))
  .map(file => ({ file: path.relative(root, file), importedBy: (incoming.get(file) ?? []).map(from => path.relative(root, from)) }));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const report = {
  scannedFiles: files.length,
  clientUnused,
  dependencyCandidates: Object.keys(pkg.dependencies).filter(name => !packages.has(name)),
  devDependencyCandidates: Object.keys(pkg.devDependencies).filter(name => !packages.has(name)),
};
fs.mkdirSync("generated-artifacts/performance", { recursive: true });
fs.writeFileSync("generated-artifacts/performance/source-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

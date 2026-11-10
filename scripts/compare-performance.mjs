import fs from "node:fs";
import assert from "node:assert/strict";

const directory = "generated-artifacts/performance";
const before = JSON.parse(fs.readFileSync(`${directory}/before.json`, "utf8"));
const after = JSON.parse(fs.readFileSync(`${directory}/after.json`, "utf8"));
function startup(report, pages) {
  const included = new Set();
  function include(file) {
    if (included.has(file)) return;
    included.add(file);
    report.files.find(item => item.file === file)?.imports.forEach(include);
  }
  report.files.filter(file => file.entry).forEach(file => include(file.file));
  pages.forEach(page => {
    const module = report.modules.find(module => module.id === `client/src/pages/${page}.tsx`);
    assert(module, `Missing page chunk: ${page}`);
    include(module.chunk);
  });
  return report.files.filter(file => included.has(file.file) && file.file.endsWith(".js"))
    .reduce((total, file) => ({ bytes: total.bytes + file.bytes, gzip: total.gzip + file.gzip }), { bytes: 0, gzip: 0 });
}
const summary = {
  before: { entry: before.initialJavaScript, login: before.initialJavaScript, allJavaScript: before.totalJavaScript, allCss: before.totalCss },
  after: { entry: after.initialJavaScript, login: startup(after, ["login"]), dashboardWithBackgroundChat: startup(after, ["dashboard", "chat"]), allJavaScript: after.totalJavaScript, allCss: after.totalCss },
  pageChunks: after.files.filter(file => file.file.endsWith(".js") && !file.entry).length,
};
assert(summary.after.login.bytes < summary.before.login.bytes * 0.5, "Login startup must shrink by at least 50%");
assert(summary.after.allJavaScript.bytes < summary.before.allJavaScript.bytes * 1.15, "Splitting must not inflate total JavaScript by more than 15%");
fs.writeFileSync(`${directory}/comparison.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

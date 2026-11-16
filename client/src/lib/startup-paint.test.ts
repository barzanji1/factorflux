import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync("client/index.html", "utf8");
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function entry(pathname: string, authFlag: string | null = null, user: string | null = null, storageThrows = false) {
  const dataset: Record<string, string> = {};
  const preloads: Record<string, string>[] = [];
  runInNewContext(bootstrap, {
    location: { pathname },
    localStorage: { getItem: (key: string) => {
      if (storageThrows) throw new Error("Storage blocked");
      return key === "user" ? user : authFlag;
    } },
    document: {
      documentElement: { dataset },
      createElement: () => ({}),
      head: { appendChild: (link: Record<string, string>) => preloads.push(link) },
    },
  });
  return { dataset, preloads };
}

test("anonymous entry preloads the unchanged login scene before the application module", () => {
  for (const path of ["/", "/login"]) {
    const result = entry(path);
    assert.equal(result.dataset.loginEntry, "");
    assert.equal(result.preloads.length, 1);
    assert.equal(result.preloads[0].href, "/assets/tpf-building-refined.jpg");
    assert.equal(result.preloads[0].as, "image");
  }
  assert.ok(html.indexOf("dataset.loginEntry") < html.indexOf('src="/src/main.tsx"'));
});

test("remembered sessions and deep links do not paint a login scene", () => {
  assert.deepEqual(entry("/", "true", "{}").preloads, []);
  for (const path of ["/invoices/42", "/portal/login", "/landing", "/unknown"]) {
    assert.deepEqual(entry(path).dataset, {});
  }
  assert.equal(entry("/", null, null, true).dataset.loginEntry, "");
});

test("a self-contained logo splash exists before application JavaScript", () => {
  const root = html.slice(html.indexOf('<div id="root">'), html.indexOf('<script type="module"'));
  assert.match(root, /class="ff-startup-splash"/);
  assert.match(root, /role="status"/);
  assert.match(root, /<svg[^>]*data-ff-startup-mark/);
  assert.match(root, /<polygon[^>]*points=/);
  assert.match(html, /\.ff-startup-splash\s*\{/);
  assert.doesNotMatch(html, /#root:empty::before/);
  assert.ok(html.indexOf(".ff-startup-splash {") < html.indexOf('<div id="root">'));
});
test("React startup fallback matches the inline splash rather than flashing bare loading text", () => {
  const component = readFileSync("client/src/components/loading/StartupSplash.tsx", "utf8");
  assert.match(component, /ff-startup-splash/);
  assert.match(component, /data-ff-startup-mark/);
  const app = readFileSync("client/src/App.tsx", "utf8");
  assert.doesNotMatch(app, /StartupIndicator|>Loading…</);
  assert.match(app, /fallback=\{<StartupSplash \/>/);
});

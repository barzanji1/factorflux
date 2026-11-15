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
    assert.equal(result.preloads[0].href, "/assets/tpf-building.jpg");
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

test("critical startup paint matches the actual login background without a loading overlay", () => {
  const css = readFileSync("client/src/pages/login.css", "utf8");
  for (const value of [
    "brightness(0.62) saturate(0.76) contrast(1.05)",
    "linear-gradient(135deg, rgba(19, 45, 63, 0.15), rgba(25, 51, 72, 0.3))",
  ]) {
    assert.ok(html.includes(value));
    assert.ok(css.includes(value));
  }
  assert.match(html, /#root:empty::before/);
  assert.doesNotMatch(html, /Loading|spinner/);
});

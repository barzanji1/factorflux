import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { getTheme, normalizeTheme, setTheme, subscribeTheme } from "./theme";

test("theme preference accepts only light or dark", () => {
  assert.equal(normalizeTheme("dark"), "dark");
  for (const value of [null, undefined, "", "system", "garbage", "light"]) {
    assert.equal(normalizeTheme(value), "light");
  }
});

test("saved theme applies before the first stylesheet, including blocked storage", () => {
  const html = readFileSync("client/index.html", "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('dataset.theme'))!;
  assert.ok(script);
  assert.ok(html.indexOf("dataset.theme") < html.indexOf("<style>"));
  for (const [saved, blocked, expected] of [
    ["dark", false, "dark"], ["light", false, "light"],
    ["invalid", false, "light"], ["dark", true, "light"],
  ] as const) {
    const classes = new Set<string>();
    const root = {
      dataset: {} as Record<string, string>, style: {} as Record<string, string>,
      classList: { toggle: (name: string, active: boolean) => active ? classes.add(name) : classes.delete(name) },
    };
    runInNewContext(script, {
      document: { documentElement: root },
      localStorage: { getItem() { if (blocked) throw Error("blocked"); return saved; } },
    });
    assert.equal(root.dataset.theme, expected);
    assert.equal(root.style.colorScheme, expected);
    assert.equal(classes.has("dark"), expected === "dark");
  }
});

test("shared theme notifies subscribers, persists, and follows other tabs", () => {
  const previous = new Map(["document", "window", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = new EventTarget();
  const root = { dataset: { theme: "light" }, style: {}, classList: { toggle() {} } };
  let saved = "", calls = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem(_key: string, value: string) { saved = value; } } });
  try {
    const unsubscribe = subscribeTheme(() => calls++);
    setTheme("dark");
    assert.equal(saved, "dark");
    assert.equal(getTheme(), "dark");
    assert.equal(calls, 1);
    const event = new Event("storage");
    Object.assign(event, { key: "theme", newValue: "light" });
    events.dispatchEvent(event);
    assert.equal(getTheme(), "light");
    assert.equal(calls, 2);
    unsubscribe();
    setTheme("dark");
    assert.equal(calls, 2);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem() { throw Error("blocked"); } } });
    assert.doesNotThrow(() => setTheme("light"));
    assert.equal(getTheme(), "light");
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

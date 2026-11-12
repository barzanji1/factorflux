import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lazyComponent, lazyPage, loadPage, preloadPage } from "./lazy-page";

test("route intent reuses imports, handles detail paths and does not import unrelated pages", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { connection: {} } });
  try {
    let detailLoads = 0, unrelatedLoads = 0;
    lazyPage(["/performance-fixture/:id"], async () => { detailLoads++; return { default: () => null }; });
    lazyPage(["/unrelated-fixture"], async () => { unrelatedLoads++; return { default: () => null }; });
    preloadPage("/performance-fixture/17?tab=history");
    preloadPage("/performance-fixture/18");
    await Promise.resolve();
    assert.equal(detailLoads, 1);
    assert.equal(unrelatedLoads, 0);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { connection: { saveData: true } } });
    preloadPage("/unrelated-fixture");
    assert.equal(unrelatedLoads, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("required navigation waits for imports even when speculative prefetch is disabled", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { connection: { saveData: true } } });
  try {
    let resolve!: (value: { default: () => null }) => void;
    let loads = 0;
    lazyPage(["/required-fixture"], () => {
      loads++;
      return new Promise(done => { resolve = done; });
    });
    preloadPage("/required-fixture");
    assert.equal(loads, 0);
    let ready = false;
    const first = loadPage("/required-fixture").then(() => { ready = true; });
    const second = loadPage("/required-fixture");
    assert.equal(loads, 1);
    assert.equal(ready, false);
    resolve({ default: () => null });
    await Promise.all([first, second]);
    assert.equal(ready, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("required import failures are surfaced and can be retried", async () => {
  let loads = 0;
  lazyPage(["/retry-fixture"], async () => {
    if (++loads === 1) throw new Error("Fixture unavailable");
    return { default: () => null };
  });
  await assert.rejects(loadPage("/retry-fixture"), /Fixture unavailable/);
  await loadPage("/retry-fixture");
  assert.equal(loads, 2);
});

test("prepared pages render synchronously without a one-frame Suspense fallback", async () => {
  const prepared = lazyComponent(async () => ({
    default: ({ label }: { label: string }) => createElement("main", null, label),
  }));
  await prepared.load();
  const html = renderToStaticMarkup(createElement(Suspense, { fallback: "Unexpected loading screen" },
    createElement(prepared.Component, { label: "Ready destination" })));
  assert.match(html, /Ready destination/);
  assert.ok(!html.includes("Unexpected loading screen"));
});

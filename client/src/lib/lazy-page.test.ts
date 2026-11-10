import assert from "node:assert/strict";
import { test } from "node:test";
import { lazyPage, preloadPage } from "./lazy-page";

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

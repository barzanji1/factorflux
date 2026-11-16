import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationController, navigationPath, navigationSearch, type NavigationOptions } from "./navigation-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(pending?: (href: string | null) => void) {
  const events: string[] = [];
  const writes: Array<[string, NavigationOptions]> = [];
  const failures: unknown[] = [];
  const controller = createNavigationController({
    pending,
    read: () => "/invoices",
    write: (href, options) => { writes.push([href, options]); events.push("history"); },
    render: commit => commit(),
    present: async commit => { events.push("present"); commit(); },
    error: error => { failures.push(error); },
  });
  controller.subscribe(() => events.push(`paint:${controller.snapshot()}`));
  return { controller, events, writes, failures };
}
test("loading feedback starts before route preparation and clears on commit", async () => {
  const values: Array<string | null> = [];
  const { controller } = fixture(value => values.push(value));
  const prepared = deferred<void>();
  controller.configure(() => prepared.promise);
  values.length = 0;
  const opening = controller.navigate("/brokers");
  assert.deepEqual(values, ["/brokers"]);
  prepared.resolve();
  await opening;
  assert.equal(controller.snapshot(), "/brokers");
  assert.equal(values.at(-1), null);
});
test("an older request cannot dismiss the latest page's loading feedback", async () => {
  const values: Array<string | null> = [];
  const { controller } = fixture(value => values.push(value));
  const old = deferred<void>(), latest = deferred<void>();
  controller.configure(href => href === "/brokers" ? old.promise : latest.promise);
  const first = controller.navigate("/brokers");
  const second = controller.navigate("/documents");
  old.resolve();
  await first;
  assert.equal(values.at(-1), "/documents");
  latest.resolve();
  await second;
  assert.equal(values.at(-1), null);
});
test("failed, cancelled, and source-page requests clear loading feedback", async () => {
  const values: Array<string | null> = [];
  const { controller } = fixture(value => values.push(value));
  controller.configure(async () => { throw new Error("Network unavailable"); });
  await controller.navigate("/brokers");
  assert.equal(values.at(-1), null);
  const prepared = deferred<void>();
  const stop = controller.configure(() => prepared.promise);
  const abandoned = controller.navigate("/documents");
  stop();
  assert.equal(values.at(-1), null);
  prepared.resolve();
  await abandoned;
  const waiting = deferred<void>();
  controller.configure(() => waiting.promise);
  const pending = controller.navigate("/brokers");
  await controller.navigate("/invoices");
  assert.equal(values.at(-1), null);
  waiting.resolve();
  await pending;
  assert.equal(controller.snapshot(), "/invoices");
});
test("routing preserves query delimiters, encoded values and fragments", () => {
  assert.equal(navigationPath("/reports?tab=aging#totals"), "/reports");
  assert.equal(navigationSearch("/help?search=why?now#answer?ignored"), "?search=why?now");
  assert.equal(navigationSearch("/help#answer?not-a-query"), "");
  assert.equal(navigationSearch("/help?search=a%3Fb%23c&tab=two"), "?search=a%3Fb%23c&tab=two");
  assert.equal(navigationSearch("/help"), "");
});
test("keeps the source mounted until preparation succeeds and commits access before location", async () => {
  const { controller, events, writes } = fixture();
  const prepared = deferred<() => void>();
  controller.configure(() => prepared.promise);
  const opening = controller.navigate("/clients?search=carrier");
  assert.equal(controller.snapshot(), "/invoices");
  assert.equal(writes.length, 0);
  prepared.resolve(() => events.push("access"));
  await opening;
  assert.deepEqual(events, ["present", "access", "history", "paint:/clients?search=carrier"]);
});
test("only the latest destination can commit, even when old preparation finishes last", async () => {
  const { controller, writes } = fixture();
  const first = deferred<() => void>();
  const second = deferred<() => void>();
  let committed = "";
  controller.configure(href => href === "/clients" ? first.promise : second.promise);
  const a = controller.navigate("/clients");
  const b = controller.navigate("/brokers");
  second.resolve(() => { committed = "brokers"; });
  await b;
  first.resolve(() => { committed = "clients"; });
  await a;
  assert.equal(committed, "brokers");
  assert.deepEqual(writes.map(([href]) => href), ["/brokers"]);
});
test("permission/import failures preserve the current page and do not write history", async () => {
  const { controller, writes, failures } = fixture();
  controller.configure(async () => { throw new Error("Access check failed"); });
  await controller.navigate("/vault");
  assert.equal(controller.snapshot(), "/invoices");
  assert.equal(writes.length, 0);
  assert.equal(failures.length, 1);
});
test("back/forward commits a prepared route without adding another history entry", async () => {
  const { controller, writes, events } = fixture();
  controller.configure(async () => () => events.push("access"));
  await controller.navigate("/calendar?view=week", {}, true);
  assert.equal(controller.snapshot(), "/calendar?view=week");
  assert.equal(writes.length, 0);
  assert.deepEqual(events, ["present", "access", "paint:/calendar?view=week"]);
});
test("failed history traversal restores the visible address rather than mismatching the page", async () => {
  const { controller, writes } = fixture();
  controller.configure(async () => { throw new Error("Offline"); });
  await controller.navigate("/vault", {}, true);
  assert.equal(controller.snapshot(), "/invoices");
  assert.deepEqual(writes, [["/invoices", { replace: true }]]);
});
test("a session change discards an already-running preparation", async () => {
  const { controller, writes } = fixture();
  const prepared = deferred<() => void>();
  controller.configure(() => prepared.promise);
  const opening = controller.navigate("/admin");
  controller.configure(async () => {});
  prepared.resolve(() => { throw new Error("Stale access must not commit"); });
  await opening;
  assert.equal(writes.length, 0);
  assert.equal(controller.snapshot(), "/invoices");
});
test("cleanup from an old configuration cannot disable the current configuration", async () => {
  const { controller, events } = fixture();
  const oldCleanup = controller.configure(async () => () => events.push("old"));
  controller.configure(async () => () => events.push("current"));
  oldCleanup();
  await controller.navigate("/reports", { replace: true, state: { tab: "aging" } });
  assert(events.includes("current"));
  assert(!events.includes("old"));
});
test("same-address navigation does not repeat preparation or create history entries", async () => {
  const { controller, writes } = fixture();
  controller.configure(async () => { throw new Error("Must not prepare"); });
  await controller.navigate("/invoices");
  assert.equal(writes.length, 0);
});
test("a cancelled presentation cannot commit later or keep waiting for destination data", async () => {
  const released = deferred<void>();
  const writes: string[] = [];
  let oldStillCurrent: (() => boolean) | undefined;
  const controller = createNavigationController({
    read: () => "/",
    write: href => { writes.push(href); },
    render: commit => commit(),
    present: async (commit, href, _from, isCurrent) => {
      if (href === "/clients") {
        oldStillCurrent = isCurrent;
        await released.promise;
      }
      commit();
    },
    error: error => { throw error; },
  });
  const first = controller.navigate("/clients");
  await Promise.resolve();
  await controller.navigate("/brokers");
  assert.equal(oldStillCurrent?.(), false);
  released.resolve();
  await first;
  assert.deepEqual(writes, ["/brokers"]);
});

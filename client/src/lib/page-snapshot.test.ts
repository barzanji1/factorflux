import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createPageSnapshot, clearPageSnapshots } from "./page-snapshot";
import { PAGE_STALE_MS, PAGE_RETAIN_MS, refreshPageOnMount } from "./page-cache-policy";

const pause = (ms = 55) => new Promise(resolve => setTimeout(resolve, ms));
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: PAGE_STALE_MS } } });
  const cleanups: Array<() => void> = [];
  const observe = (key: string, queryFn: () => Promise<unknown>, enabled = true) => {
    const observer = new QueryObserver(client, { queryKey: [key], queryFn, enabled });
    cleanups.push(observer.subscribe(() => {}));
    return observer;
  };
  const snapshot = createPageSnapshot(client, "/invoices");
  cleanups.push(snapshot.start(), snapshot.mountContent());
  return { client, snapshot, observe, cleanup() { cleanups.reverse().forEach(clean => clean()); client.clear(); } };
}
test("independent reads start in parallel and reveal only after all cold data settles", async () => {
  const s = setup(); let first!: (value: unknown) => void, second!: (value: unknown) => void;
  let started = 0;
  s.observe("/api/invoices", () => { started++; return new Promise(resolve => { first = resolve; }); });
  s.observe("page-insights", () => { started++; return new Promise(resolve => { second = resolve; }); });
  assert.equal(started, 2);
  first({ records: [1] }); await pause();
  assert.equal(s.snapshot.ready, false);
  second({ total: 1 }); await pause();
  assert.equal(s.snapshot.ready, true);
  const revisit = createPageSnapshot(s.client, "/invoices");
  assert.equal(revisit.ready, true);
  s.cleanup();
});
test("dependent reads join the same first-visit barrier", async () => {
  const s = setup(); let finish!: (value: unknown) => void;
  const parent = s.observe("/api/invoices/detail", async () => ({ carrierId: 7 }));
  const off = parent.subscribe(result => {
    if (result.data) s.observe("/api/carrier/7", () => new Promise(resolve => { finish = resolve; }));
  });
  // Cached synchronous success can precede the extra test subscriber.
  if (!finish) await pause(5);
  assert.equal(s.snapshot.ready, false);
  finish({ name: "Fixture" }); await pause();
  assert.equal(s.snapshot.ready, true);
  off(); s.cleanup();
});
test("background workspace polling and disabled lookups do not hold page data", async () => {
  const s = setup();
  s.observe("/api/chat/channels", () => new Promise(() => {}));
  s.observe("/api/users", () => new Promise(() => {}), false);
  await pause(); assert.equal(s.snapshot.ready, true); s.cleanup();
});
test("errors resolve to the page error state instead of permanent placeholders", async () => {
  const s = setup();
  s.observe("/api/invoices", async () => { throw new Error("Read failed"); });
  await pause(); assert.equal(s.snapshot.ready, true); s.cleanup();
});
test("removed cached data and a cleared session cannot reuse a completed snapshot", async () => {
  const s = setup();
  s.observe("/api/invoices", async () => ({ total: 2 }));
  await pause(); assert.equal(s.snapshot.ready, true);
  s.client.clear(); clearPageSnapshots(s.client);
  assert.equal(createPageSnapshot(s.client, "/invoices").ready, false); s.cleanup();
});
test("unchanged background results preserve cached data identity", async () => {
  const s = setup();
  const observer = s.observe("/api/invoices", async () => ({ total: 2 }));
  await pause(); const data = observer.getCurrentResult().data;
  await observer.refetch();
  assert.equal(observer.getCurrentResult().data, data);
  assert.equal(s.snapshot.ready, true); s.cleanup();
});
test("changed background results propagate without hiding completed content", async () => {
  const s = setup(); let total = 2;
  const observer = s.observe("/api/invoices", async () => ({ total }));
  await pause(); const previous = observer.getCurrentResult().data;
  total = 3; await observer.refetch();
  assert.notEqual(observer.getCurrentResult().data, previous);
  assert.deepEqual(observer.getCurrentResult().data, { total: 3 });
  assert.equal(s.snapshot.ready, true); s.cleanup();
});
test("staleness is 60 seconds but mount refresh begins after 30 seconds", () => {
  assert.equal(PAGE_STALE_MS, 60_000);
  assert.equal(PAGE_RETAIN_MS, 1_800_000);
  assert.equal(refreshPageOnMount({ state: { dataUpdatedAt: Date.now() - 29_000 } }), false);
  assert.equal(refreshPageOnMount({ state: { dataUpdatedAt: Date.now() - 31_000 } }), "always");
});

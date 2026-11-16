import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { DASHBOARD_STALE_TIME, invalidateDashboard, withDashboardInvalidation } from "./dashboard-freshness";

const origin = "https://test.invalid";

test("successful staff writes invalidate once without consuming the response", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    let invalidations = 0;
    const response = new Response('{"saved":true}', { status: 200 });
    const fetcher = withDashboardInvalidation(async () => response, origin, async () => { ++invalidations; });
    assert.equal(await fetcher("/api/invoices/123", { method }), response);
    assert.equal(invalidations, 1, method);
    assert.equal(response.bodyUsed, false);
    assert.deepEqual(await response.json(), { saved: true });
  }
});

test("Request method and init overrides work for direct-fetch forms", async () => {
  let invalidations = 0;
  const fetcher = withDashboardInvalidation(async () => new Response(null, { status: 204 }), origin,
    async () => { ++invalidations; });
  const request = new Request(`${origin}/api/tasks/1`, { method: "PATCH" });
  await fetcher(request);
  assert.equal(invalidations, 1);
  await fetcher(request, { method: "GET" });
  assert.equal(invalidations, 1);
  await fetcher(new URL(`${origin}/api/documents/1`), { method: "delete" });
  assert.equal(invalidations, 2);
});

test("reads, failed writes, external requests, auth and portal do not invalidate staff data", async () => {
  let invalidations = 0;
  const fetcher = withDashboardInvalidation(async () => new Response(null, { status: 204 }), origin,
    async () => { ++invalidations; });
  for (const url of ["/api/invoices", "/api/agent-dashboard/financial"]) await fetcher(url);
  for (const url of ["/api/auth/logout", "/api/portal/login", "/assets/test", "https://other.invalid/api/invoices"]) {
    await fetcher(url, { method: "POST" });
  }
  for (const status of [400, 401, 403, 409, 500]) {
    const failing = withDashboardInvalidation(async () => new Response(null, { status }), origin,
      async () => { ++invalidations; });
    await failing("/api/invoices/1", { method: "PATCH" });
  }
  assert.equal(invalidations, 0);
});

test("a refresh error never changes the result of a successful save", async () => {
  const fetcher = withDashboardInvalidation(async () => new Response(null, { status: 204 }), origin,
    async () => { throw new Error("refresh unavailable"); });
  assert.equal((await fetcher("/api/tasks", { method: "POST" })).status, 204);
});

test("invalidates inactive dashboard sections, not unrelated caches", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  try {
    for (const key of [
      ["/api/agent-dashboard/financial", "staff", "employee"],
      ["/api/agent-dashboard/alerts", "staff", "employee"],
      ["/api/dashboard/stats"], ["/api/tasks"], ["/api/agent-dashboard-other"],
    ]) client.setQueryData(key, { loaded: true });
    await invalidateDashboard(client);
    assert.equal(client.getQueryState(["/api/agent-dashboard/financial", "staff", "employee"])?.isInvalidated, true);
    assert.equal(client.getQueryState(["/api/agent-dashboard/alerts", "staff", "employee"])?.isInvalidated, true);
    assert.equal(client.getQueryState(["/api/dashboard/stats"])?.isInvalidated, true);
    assert.equal(client.getQueryState(["/api/tasks"])?.isInvalidated, false);
    assert.equal(client.getQueryState(["/api/agent-dashboard-other"])?.isInvalidated, false);
  } finally { client.clear(); }
});

test("active dashboard sections refresh in parallel after a write", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const unsubscribes: Array<() => void> = [];
  try {
    for (const section of ["followups", "activity", "alerts", "financial"]) {
      const key = [`/api/agent-dashboard/${section}`, "staff"];
      client.setQueryData(key, { loaded: true });
      const observer = new QueryObserver(client, {
        queryKey: key, staleTime: DASHBOARD_STALE_TIME,
        queryFn: async () => {
          started.push(section);
          await new Promise<void>(resolve => releases.push(resolve));
          return { loaded: true };
        },
      });
      unsubscribes.push(observer.subscribe(() => undefined));
    }
    const refresh = invalidateDashboard(client);
    assert.deepEqual(started, ["followups", "activity", "alerts", "financial"]);
    releases.forEach(release => release());
    await refresh;
  } finally {
    releases.forEach(release => release());
    unsubscribes.forEach(unsubscribe => unsubscribe());
    client.clear();
  }
});

test("dashboard revisit reuses a snapshot under 30s and refetches an older snapshot", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  try {
    for (const age of [29_000, 31_000]) {
      let requests = 0;
      const key = ["/api/agent-dashboard/financial", String(age)];
      client.setQueryData(key, { count: 1 }, { updatedAt: Date.now() - age });
      const observer = new QueryObserver(client, {
        queryKey: key, staleTime: DASHBOARD_STALE_TIME, refetchOnMount: true,
        queryFn: async () => { ++requests; return { count: 2 }; },
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(requests, age > DASHBOARD_STALE_TIME ? 1 : 0);
      unsubscribe();
    }
  } finally { client.clear(); }
});

test("a successful write forces a fresh dashboard even inside the 30s window", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  try {
    const key = ["/api/agent-dashboard/financial", "staff"];
    client.setQueryData(key, { count: 1 });
    await invalidateDashboard(client);
    let requests = 0;
    const observer = new QueryObserver(client, {
      queryKey: key, staleTime: DASHBOARD_STALE_TIME, refetchOnMount: true,
      queryFn: async () => { ++requests; return { count: 2 }; },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requests, 1);
    unsubscribe();
  } finally { client.clear(); }
});

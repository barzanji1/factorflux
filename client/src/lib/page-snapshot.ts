import type { Query, QueryClient } from "@tanstack/react-query";

const snapshots = new WeakMap<QueryClient, Map<string, string[]>>();
function index(client: QueryClient) {
  let result = snapshots.get(client);
  if (!result) { result = new Map(); snapshots.set(client, result); }
  return result;
}
export function clearPageSnapshots(client: QueryClient) { snapshots.delete(client); }
export function hasCachedPageSnapshot(client: QueryClient, route: string) {
  const previous = index(client).get(route);
  if (previous) return previous.every(hash => client.getQueryCache().get(hash)?.state.data !== undefined);
  // Chat's session-lived workspace is outside the route subtree by design.
  return route === "/chat" && client.getQueryCache().getAll().some(query =>
    String(query.queryKey[0]) === "/api/chat/channels" && query.state.data !== undefined);
}

function belongsToContent(query: Query, route: string) {
  const key = String(query.queryKey[0]);
  // Long-lived workspace services are not part of a page's first-data barrier.
  return !(route.split("?")[0] !== "/chat" && /^\/api\/chat(?:\/|$)/.test(key))
    && !(!["/", "/chat"].includes(route.split("?")[0]) && /^\/api\/announcements(?:\/|$)/.test(key))
    && !/^\/api\/(?:auth(?:\/|$)|carrier-chat(?:\/|$)|time-tracking(?:\/|$))/.test(key)
    && !/unread-count|pending-count|unreviewed-count/.test(key);
}

/** The content tree stays mounted: all independent hooks start together. */
export function createPageSnapshot(client: QueryClient, route: string) {
  const cache = client.getQueryCache();
  let ready = hasCachedPageSnapshot(client, route);
  let contentCount = 0;
  let timedOut = false, disposed = false, version = 0;
  let frame: ReturnType<typeof setTimeout> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const queries = new Set<Query>(), listeners = new Set<() => void>();
  const emit = () => { version++; for (const listener of listeners) listener(); };
  const cold = () => [...queries].some(query => query.isActive()
    && query.state.data === undefined && query.state.status === "pending");
  const schedule = () => {
    if (ready || disposed) return;
    clearTimeout(frame);
    // Allow React to register child/dependent observers before the single reveal.
    if (contentCount > 0 && !cold()) frame = setTimeout(() => {
      if (disposed || !contentCount || cold()) return;
      ready = true;
      clearTimeout(timeout);
      index(client).set(route, [...queries].filter(query => query.state.data !== undefined).map(query => query.queryHash));
      emit();
    }, 32);
  };
  return {
    getSnapshot: () => version,
    get ready() { return ready; },
    get timedOut() { return timedOut; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mountContent() {
      contentCount++;
      schedule();
      return () => { contentCount--; schedule(); };
    },
    start() {
      disposed = false;
      if (ready) return () => {};
      unsubscribe = cache.subscribe(event => {
        if (!belongsToContent(event.query, route)) return;
        if (event.type === "observerAdded" || event.type === "added"
          || event.type === "updated" && event.action.type === "fetch") queries.add(event.query);
        if (event.type === "removed") queries.delete(event.query);
        schedule();
      });
      // Covers parent hooks whose observers subscribed before the shell effect.
      for (const query of cache.getAll()) if (belongsToContent(query, route)
        && query.isActive() && query.state.data === undefined) queries.add(query);
      timeout = setTimeout(() => { if (!ready && !disposed) { timedOut = true; emit(); } }, 30_000);
      schedule();
      return () => { disposed = true; unsubscribe?.(); clearTimeout(frame); clearTimeout(timeout); };
    },
    async retry() {
      timedOut = false;
      emit();
      for (const query of queries) if (query.state.data === undefined) {
        await client.cancelQueries({ queryKey: query.queryKey, exact: true });
        void client.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
      clearTimeout(timeout);
      timeout = setTimeout(() => { if (!ready && !disposed) { timedOut = true; emit(); } }, 30_000);
      schedule();
    },
  };
}

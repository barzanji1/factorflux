import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const DASHBOARD_STALE_TIME = 60_000;

export function isDashboardQuery(key: QueryKey) {
  const endpoint = key[0];
  return typeof endpoint === "string"
    && /^\/api\/(?:agent-dashboard|dashboard)(?:[/?]|$)/.test(endpoint);
}

export function invalidateDashboard(client: QueryClient) {
  // Inactive dashboards are marked stale too, so returning after a write
  // refreshes immediately even when the previous snapshot is under 30s old.
  return client.invalidateQueries({ predicate: query => isDashboardQuery(query.queryKey) });
}

/** Covers both React Query mutations and older forms that call fetch directly. */
export function withDashboardInvalidation(
  fetcher: typeof fetch,
  origin: string,
  invalidate: () => Promise<unknown>,
): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (response.ok && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const url = new URL(request?.url ?? String(input), origin);
      if (url.origin === origin && url.pathname.startsWith("/api/")
        && !/^\/api\/(?:auth|portal)(?:\/|$)/.test(url.pathname)) {
        // Do not serialize the save or consume its response body. A refresh
        // failure must not turn a successful server write into a failed save.
        void invalidate().catch(() => undefined);
      }
    }
    return response;
  };
}

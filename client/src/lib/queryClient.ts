import { MutationCache, QueryCache, QueryClient, QueryFunction } from "@tanstack/react-query";
import { invalidateDashboard, withDashboardInvalidation } from "./dashboard-freshness";
import { PAGE_RETAIN_MS, PAGE_STALE_MS, refreshPageOnMount } from "./page-cache-policy";
import { clearPageSnapshots } from "./page-snapshot";

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, message: string, url: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new HttpError(res.status, text, res.url);
  }
}

function isForbidden(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 403;
}

const ACCESS_DENIED_EVENT = "app:access-denied";
const FETCH_INTERCEPTOR_KEY = "__factorFluxPermissionFetchInterceptor";
const accessDeniedNotifications = new Map<string, number>();

function endpointPath(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function notifyAccessDenied(url: string) {
  if (typeof window === "undefined") return;
  const key = endpointPath(url);
  const now = Date.now();
  const previous = accessDeniedNotifications.get(key) ?? 0;
  // Query/mutation error handlers can observe the same response after the
  // fetch interceptor. Coalesce that duplicate notification briefly.
  if (now - previous < 1000) return;
  accessDeniedNotifications.set(key, now);
  window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, { detail: { url } }));
}

function removeUnauthorizedEndpointData(url: string) {
  const endpoint = endpointPath(url);
  const matchingQueries = queryClient.getQueryCache().findAll().filter((query) => {
    const first = query.queryKey[0];
    if (typeof first !== "string") return false;
    const keyEndpoint = endpointPath(first);
    return endpoint === keyEndpoint
      || endpoint.startsWith(`${keyEndpoint}?`)
      || endpoint.startsWith(`${keyEndpoint}/`);
  });

  if (matchingQueries.length) {
    matchingQueries.forEach((query) => queryClient.removeQueries({ queryKey: query.queryKey }));
    return;
  }

  // A direct fetch may use a URL shape that cannot be related to a query key.
  // Do not leave potentially unauthorized endpoint data in the cache.
  queryClient.clear();
}

function installFetchInterceptor() {
  if (typeof window === "undefined") return;
  const target = window as Window & {
    [FETCH_INTERCEPTOR_KEY]?: typeof window.fetch;
  };
  if (target[FETCH_INTERCEPTOR_KEY]) return;

  const originalFetch = window.fetch.bind(window);
  const fetchWithFreshDashboard = withDashboardInvalidation(
    originalFetch, window.location.origin, () => invalidateDashboard(queryClient),
  );
  const interceptedFetch: typeof window.fetch = async (...args) => {
    const response = await fetchWithFreshDashboard(...args);
    const requestUrl = typeof args[0] === "string"
      ? args[0]
      : args[0] instanceof URL
        ? args[0].toString()
        : args[0].url;
    let sameApp = false;
    try {
      sameApp = new URL(requestUrl, window.location.origin).origin === window.location.origin;
    } catch {
      sameApp = false;
    }
    if (sameApp && response.status === 403) {
      removeUnauthorizedEndpointData(requestUrl);
      notifyAccessDenied(requestUrl);
    }
    return response;
  };

  // Keep the original on a window-owned marker so HMR cannot wrap fetch twice.
  target[FETCH_INTERCEPTOR_KEY] = originalFetch;
  window.fetch = interceptedFetch;
}

function clearUnauthorizedCache(error: unknown, queryKey?: readonly unknown[]) {
  if (!isForbidden(error)) return;
  if (queryKey) {
    queryClient.removeQueries({ queryKey });
  }
  if (!queryKey && error.url) removeUnauthorizedEndpointData(error.url);
  notifyAccessDenied(error.url);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isFormData = data instanceof FormData;
  
  const res = await fetch(url, {
    method,
    headers: data && !isFormData ? { "Content-Type": "application/json" } : {},
    body: data ? (isFormData ? data : JSON.stringify(data)) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const [base, ...rest] = queryKey;
    const compatibilityParams = rest.length === 1
      && typeof rest[0] === "object"
      && rest[0] !== null
      && (rest[0] as Record<string, unknown>).all === true;
    const url = compatibilityParams
      ? `${String(base)}?all=true`
      : queryKey.join("/");
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => clearUnauthorizedCache(error, query.queryKey),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.options.meta as { queryKey?: readonly unknown[] } | undefined;
      clearUnauthorizedCache(error, meta?.queryKey);
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: PAGE_STALE_MS,
      gcTime: PAGE_RETAIN_MS,
      refetchOnMount: refreshPageOnMount,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function clearStaffDataCache() {
  queryClient.clear();
  clearPageSnapshots(queryClient);
}

installFetchInterceptor();

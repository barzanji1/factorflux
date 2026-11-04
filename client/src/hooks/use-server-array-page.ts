import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";

export const SERVER_ARRAY_PAGE_SIZE = DEFAULT_PAGE_SIZE;

type PageResponse<T> = {
  items: T[];
  total: number;
  filterOptions: ServerArrayFilterOptions;
  resolvedPage: number | null;
};

export type ServerArrayFilterOptions = {
  entities: string[];
  actions: string[];
  actors: string[];
};

type UseServerArrayPageOptions = {
  enabled?: boolean;
  resetKey?: string;
  params?: Record<string, string>;
  refetchInterval?: number | false;
};

export function useServerArrayPage<T>(endpoint: string, options: UseServerArrayPageOptions = {}) {
  const { enabled = true, resetKey = "", params = {}, refetchInterval } = options;
  const [page, setPage] = useState(1);
  const [lastFilterOptions, setLastFilterOptions] = useState<ServerArrayFilterOptions>({ entities: [], actions: [], actors: [] });
  const previousResetKey = useRef(resetKey);
  const paramsKey = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  useEffect(() => {
    if (previousResetKey.current !== resetKey) {
      previousResetKey.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const query = useQuery<PageResponse<T>>({
    queryKey: [endpoint, page, SERVER_ARRAY_PAGE_SIZE, paramsKey],
    enabled,
    refetchInterval,
    queryFn: async ({ signal }) => {
      const url = new URL(endpoint, window.location.origin);
      new URLSearchParams(paramsKey).forEach((value, key) => url.searchParams.set(key, value));
      url.searchParams.set("page", String(page));
      url.searchParams.set("limit", String(SERVER_ARRAY_PAGE_SIZE));
      const response = await fetch(url.toString(), { credentials: "include", signal });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || `Could not load history (HTTP ${response.status}).`);
      }
      const items: unknown = await response.json();
      if (!Array.isArray(items)) throw new Error("The history endpoint returned an unexpected response.");
      const totalHeader = response.headers.get("X-Total-Count");
      const headerTotal = totalHeader === null ? Number.NaN : Number(totalHeader);
      const total = Number.isFinite(headerTotal) && headerTotal >= 0 ? headerTotal : items.length;
      const pageHeader = response.headers.get("X-Page");
      const parsedPage = pageHeader === null ? Number.NaN : Number(pageHeader);
      const resolvedPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : null;
      let filterOptions: ServerArrayFilterOptions = { entities: [], actions: [], actors: [] };
      const filterHeader = response.headers.get("X-Filter-Options");
      if (filterHeader) {
        try {
          const parsed = JSON.parse(filterHeader) as Partial<ServerArrayFilterOptions>;
          filterOptions = {
            entities: Array.isArray(parsed.entities) ? parsed.entities : [],
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            actors: Array.isArray(parsed.actors) ? parsed.actors : [],
          };
        } catch {
          // Keep the filter controls usable even if an intermediary returns a malformed header.
        }
      }
      return { items: items as T[], total, filterOptions, resolvedPage };
    },
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const resolvedPage = query.data?.resolvedPage ?? null;
  useEffect(() => {
    if (query.data?.filterOptions) setLastFilterOptions(query.data.filterOptions);
  }, [query.data?.filterOptions]);
  const filterOptions = query.data?.filterOptions ?? lastFilterOptions;
  const pageCount = Math.max(1, Math.ceil(total / SERVER_ARRAY_PAGE_SIZE));

  useEffect(() => {
    // A new page has no cached total while loading. Clamping then cancels page 2
    // and immediately sends the user back to page 1.
    if (query.data && !query.isFetching && page > pageCount) setPage(pageCount);
  }, [page, pageCount, query.data, query.isFetching]);

  return {
    ...query,
    items,
    total,
    filterOptions,
    resolvedPage,
    page,
    pageSize: SERVER_ARRAY_PAGE_SIZE,
    pageCount,
    setPage,
  };
}

export { ServerArrayPagination } from "@/components/server-array-pagination";

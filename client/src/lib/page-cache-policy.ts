/** One in-memory, session-scoped cache; never persist staff data in localStorage. */
export const PAGE_STALE_MS = 60_000;
export const PAGE_REFRESH_MS = 30_000;
export const PAGE_RETAIN_MS = 30 * 60_000;

export function refreshPageOnMount(query: { state: { dataUpdatedAt: number } }): "always" | false {
  return Date.now() - query.state.dataUpdatedAt > PAGE_REFRESH_MS ? "always" : false;
}

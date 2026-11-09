import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "wouter";

/**
 * For user-initiated shell navigation only. Commit the destination before the
 * click handler returns, rather than leaving the previous page in the DOM
 * until React's scheduled work runs. Do not use from render/effects (Redirect).
 * Wouter still owns history, matching, query strings and back/forward behavior.
 */
export function useImmediateNavigation() {
  const [location, navigate] = useLocation();
  const navigateImmediately = useCallback<typeof navigate>((...args) => {
    flushSync(() => navigate(...args));
  }, [navigate]);
  return [location, navigateImmediately] as const;
}

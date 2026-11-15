import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "wouter";

/**
 * User-initiated shell navigation. Preserve the shared router's preparation
 * promise so callers can track pending navigation; final location commits are
 * synchronous. Do not use from render/effects (Redirect).
 */
export function useImmediateNavigation() {
  const [location, navigate] = useLocation();
  const navigateImmediately = useCallback<typeof navigate>((...args) => {
    return flushSync(() => navigate(...args));
  }, [navigate]);
  return [location, navigateImmediately] as const;
}

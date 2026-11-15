import { useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";
import { loadPage } from "./lazy-page";
import { createNavigationController, navigationPath as pathname, navigationSearch, type NavigationOptions } from "./navigation-controller";

const publicPage = (href: string) => /^\/(?:login|portal(?:\/|$))/.test(href.split(/[?#]/)[0]);
const readBrowser = () => location.pathname + location.search + location.hash;
let writing = false;
let listening = false;
let subscribers = 0;
let activeTransition: { skipTransition(): void } | undefined;

// Wait only for newly mounted, uncached destination queries. Existing chat
// polling and background refreshes must never hold navigation hostage.
async function settleDestination(previous: Set<string>, isCurrent: () => boolean) {
  const deadline = performance.now() + 1500;
  let quiet = 0;
  while (isCurrent() && performance.now() < deadline) {
    const pending = queryClient.getQueryCache().findAll({ type: "active" }).some(query =>
      !previous.has(query.queryHash) && query.state.data === undefined &&
      (query.state.fetchStatus === "fetching" || query.state.fetchStatus === "paused"));
    // A few older pages still use local fetch state instead of React Query.
    const localLoading = [...document.querySelectorAll("main [role='status']")].some(element =>
      /^(?:loading|fetching|please wait)\b/i.test(element.textContent?.trim() ?? ""));
    quiet = pending || localLoading ? 0 : quiet + 1;
    if (quiet >= 2) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const controller = createNavigationController({
  read: readBrowser,
  write(href, options) {
    writing = true;
    try { history[options.replace ? "replaceState" : "pushState"](options.state ?? null, "", href); }
    finally { writing = false; }
  },
  render: commit => flushSync(commit),
  async present(commit, href, from, isCurrent) {
    if (publicPage(from) || publicPage(href) || pathname(href) === pathname(from) ||
      typeof document.startViewTransition !== "function") {
      activeTransition?.skipTransition();
      activeTransition = undefined;
      delete document.documentElement.dataset.pageTransition;
      commit();
      return;
    }
    const previous = new Set(queryClient.getQueryCache().findAll({ type: "active" }).map(query => query.queryHash));
    activeTransition?.skipTransition();
    document.documentElement.dataset.pageTransition = "holding";
    let transition: ReturnType<Document["startViewTransition"]>;
    try {
      transition = document.startViewTransition(async () => {
        commit();
        await settleDestination(previous, isCurrent);
      });
    } catch {
      delete document.documentElement.dataset.pageTransition;
      commit();
      return;
    }
    activeTransition = transition;
    void transition.finished.catch(() => undefined);
    void transition.ready.catch(() => undefined);
    try {
      // Native snapshots retain the last painted page, not a cloned React tree.
      // No duplicate controls, SVG IDs, effects, auth bypass or hidden requests.
      await transition.updateCallbackDone;
    } finally {
      if (activeTransition === transition) {
        delete document.documentElement.dataset.pageTransition;
        activeTransition = undefined;
      }
    }
    // A newer navigation or reduced-motion policy may skip the animation.
  },
  error(error) {
    toast({ title: "Page could not open", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" });
  },
});

function historyChanged() {
  if (!writing) void controller.navigate(readBrowser(), {}, true);
}
function subscribe(listener: () => void) {
  // Read lazily after main.tsx has resolved anonymous home visits to /login.
  controller.snapshot();
  const unsubscribe = controller.subscribe(listener);
  if (!listening) {
    for (const event of ["popstate", "pushState", "replaceState", "hashchange"]) addEventListener(event, historyChanged);
    listening = true;
  }
  ++subscribers;
  return () => {
    unsubscribe();
    if (--subscribers === 0) {
      for (const event of ["popstate", "pushState", "replaceState", "hashchange"]) removeEventListener(event, historyChanged);
      listening = false;
    }
  };
}
function useHref() {
  return useSyncExternalStore(subscribe, controller.snapshot, () => "/");
}
export function useSeamlessLocation(): [string, (href: string, options?: NavigationOptions) => Promise<void> | void] {
  return [pathname(useHref()), (href: string, options?: NavigationOptions) => {
    const target = new URL(href, new URL(controller.snapshot(), location.origin));
    if (target.origin !== location.origin) { location.assign(target.href); return; }
    return controller.navigate(target.pathname + target.search + target.hash, options);
  }];
}
export function useSeamlessSearch() {
  return navigationSearch(useHref());
}

/** Runs under AuthProvider, while the router's location hook stays auth-free. */
export function NavigationCoordinator() {
  const { isAuthenticated, user, prepareRoute } = useAuth();
  useLayoutEffect(() => controller.configure(async (href, from) => {
    if (!isAuthenticated || !user || publicPage(from) || publicPage(href) || pathname(href) === pathname(from)) return;
    const [, commitAccess] = await Promise.all([loadPage(href), prepareRoute(href)]);
    return commitAccess;
  }), [isAuthenticated, user?.id, prepareRoute]);
  return null;
}

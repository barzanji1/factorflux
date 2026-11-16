import { useLayoutEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { loadPage } from "./lazy-page";
import { createNavigationController, navigationPath as pathname, navigationSearch, type NavigationOptions } from "./navigation-controller";

const publicPage = (href: string) => /^\/(?:login|portal(?:\/|$))/.test(href.split(/[?#]/)[0]);
const readBrowser = () => location.pathname + location.search + location.hash;
let writing = false;
let listening = false;
let subscribers = 0;
let activeTransition: { skipTransition(): void } | undefined;
let pendingHref: string | null = null;
const pendingListeners = new Set<() => void>();
export function usePendingNavigation() {
  return useSyncExternalStore(listener => {
    pendingListeners.add(listener);
    return () => { pendingListeners.delete(listener); };
  }, () => pendingHref, () => null);
}

const controller = createNavigationController({
  read: readBrowser,
  write(href, options) {
    writing = true;
    try { history[options.replace ? "replaceState" : "pushState"](options.state ?? null, "", href); }
    finally { writing = false; }
  },
  render: commit => flushSync(commit),
  pending(href) {
    if (pendingHref === href) return;
    pendingHref = href;
    for (const listener of pendingListeners) listener();
  },
  async present(commit, href, from) {
    const staffSignIn = pathname(from) === "/login" && pathname(href) === "/";
    const root = document.documentElement;
    // Only sign-in needs a whole-window snapshot. On staff navigation that
    // snapshot intercepts hover/focus and makes the live sidebar collapse.
    // Prepared pages already have immediate content-only loading feedback.
    if (!staffSignIn ||
      pathname(href) === pathname(from) ||
      typeof document.startViewTransition !== "function" ||
      (staffSignIn && matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      activeTransition?.skipTransition();
      activeTransition = undefined;
      delete root.dataset.pageTransition;
      delete root.dataset.loginTransition;
      commit();
      return;
    }
    activeTransition?.skipTransition();
    root.dataset.pageTransition = "holding";
    if (staffSignIn) root.dataset.loginTransition = "fade";
    else delete root.dataset.loginTransition;
    let transition: ReturnType<Document["startViewTransition"]>;
    try {
      transition = document.startViewTransition(() => {
        commit();
        // Reveal the destination's structural loading state immediately.
        // Data queries run independently; polling must never delay a page.
      });
    } catch {
      delete root.dataset.pageTransition;
      delete root.dataset.loginTransition;
      commit();
      return;
    }
    activeTransition = transition;
    const finish = () => {
      if (activeTransition !== transition) return;
      activeTransition = undefined;
      delete root.dataset.pageTransition;
      delete root.dataset.loginTransition;
    };
    // Keep the login-only duration active until the actual fade finishes,
    // not merely until the dashboard mounts behind the native snapshot.
    void transition.finished.then(finish, finish);
    void transition.ready.catch(() => undefined);
    try {
      // Native snapshots retain the last painted page, not a cloned React tree.
      // No duplicate controls, SVG IDs, effects, auth bypass or hidden requests.
      await transition.updateCallbackDone;
    } finally {
      if (activeTransition === transition) {
        delete root.dataset.pageTransition;
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

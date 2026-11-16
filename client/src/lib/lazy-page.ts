import { createElement, lazy, useState, type ComponentProps, type ComponentType } from "react";

const preloads: Array<{ urls: string[]; paths: Array<{ pattern: RegExp; parameters: number }>; load: () => Promise<unknown> }> = [];

/** Preserve lazy loading, but mount already-prepared components synchronously. */
export function lazyComponent<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | undefined;
  let resolved: { default: T } | undefined;
  const load = () => pending ??= loader().then(module => {
    resolved = module;
    return module;
  }).catch(error => {
    pending = undefined;
    throw error;
  });
  const Deferred = lazy(load);
  function PreparedComponent(props: ComponentProps<T>) {
    // Choose once per mount: swapping Deferred for the resolved type on a later
    // render would remount forms and lose their local state.
    const [Component] = useState<ComponentType<any>>(() => resolved?.default ?? Deferred);
    return createElement(Component, props);
  }
  return { Component: PreparedComponent, load };
}

/** Share the import promise between intent preloading and React.lazy. */
export function lazyPage<T extends ComponentType<any>>(paths: string[], loader: () => Promise<{ default: T }>) {
  const deferred = lazyComponent(loader);
  preloads.push({
    urls: paths,
    paths: paths.map(path => ({
      parameters: path.split("/").filter(segment => segment.startsWith(":")).length,
      pattern: new RegExp(`^${path.split("/").map(segment =>
        segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ).join("/")}/?$`),
    })),
    load: deferred.load,
  });
  return deferred.Component;
}

/** Warm staff chunks between interactions, without fetching page data. */
export function warmStaffPages() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType?.includes("2g")) return () => {};
  let cancelled = false;
  const pages = preloads.filter(page => page.urls.some(url => !/^\/(?:login|portal(?:\/|$)|neu-preview)/.test(url)));
  let next = 0;
  const idle = () => new Promise<void>(resolve => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 1000 });
    else setTimeout(resolve, 50);
  });
  const worker = async () => {
    while (!cancelled && next < pages.length) {
      await idle();
      if (cancelled) return;
      const page = pages[next++];
      if (page) await page.load().catch(() => undefined);
    }
  };
  // Let first-page API responses and rendering take priority.
  const start = setTimeout(() => { void worker(); void worker(); }, 1500);
  return () => { cancelled = true; clearTimeout(start); };
}

export function preloadPage(href: string) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType?.includes("2g")) return;
  // Speculation must not disrupt the current page. Actual navigation retries a
  // failed import and surfaces persistent failures through the error boundary.
  void loadPage(href).catch(() => undefined);
}

/** Required navigation preparation, unlike optional pointer-intent prefetch. */
export function loadPage(href: string): Promise<unknown> {
  const path = href.split(/[?#]/)[0];
  // Literal /carriers/new must beat /carriers/:id, regardless of declaration order.
  let selected: (typeof preloads)[number] | undefined;
  let specificity = Infinity;
  for (const page of preloads) {
    for (const candidate of page.paths) {
      if (candidate.parameters < specificity && candidate.pattern.test(path)) {
        selected = page;
        specificity = candidate.parameters;
      }
    }
  }
  return selected ? selected.load() : Promise.resolve();
}

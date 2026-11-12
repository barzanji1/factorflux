import { createElement, lazy, useState, type ComponentProps, type ComponentType } from "react";

const preloads: Array<{ paths: RegExp[]; load: () => Promise<unknown> }> = [];

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
    paths: paths.map(path => new RegExp(`^${path.split("/").map(segment =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("/")}/?$`)),
    load: deferred.load,
  });
  return deferred.Component;
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
  const page = preloads.find(page => page.paths.some(pattern => pattern.test(path)));
  return page ? page.load() : Promise.resolve();
}

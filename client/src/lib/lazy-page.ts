import { lazy, type ComponentType } from "react";

const preloads: Array<{ paths: RegExp[]; load: () => Promise<unknown> }> = [];

/** Share the import promise between intent preloading and React.lazy. */
export function lazyPage<T extends ComponentType<any>>(paths: string[], loader: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | undefined;
  const load = () => pending ??= loader().catch(error => {
    pending = undefined;
    throw error;
  });
  preloads.push({
    paths: paths.map(path => new RegExp(`^${path.split("/").map(segment =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("/")}/?$`)),
    load,
  });
  return lazy(load);
}

export function preloadPage(href: string) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType?.includes("2g")) return;
  const path = href.split(/[?#]/)[0];
  const page = preloads.find(page => page.paths.some(pattern => pattern.test(path)));
  // Speculation must not disrupt the current page. Actual navigation retries a
  // failed import and surfaces persistent failures through the error boundary.
  void page?.load().catch(() => undefined);
}

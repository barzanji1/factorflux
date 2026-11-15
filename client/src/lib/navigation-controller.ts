export type NavigationOptions = { replace?: boolean; state?: unknown };
type Commit = () => void;
type Prepare = (href: string, from: string) => Promise<Commit | void>;

export const navigationPath = (href: string) => href.split(/[?#]/)[0] || "/";
export function navigationSearch(href: string) {
  const query = href.indexOf("?");
  const hash = href.indexOf("#");
  return query < 0 || (hash >= 0 && hash < query) ? "" : href.slice(query, hash < 0 ? undefined : hash);
}

/** One latest-request-wins coordinator for links, buttons and history traversal. */
export function createNavigationController(deps: {
  read: () => string;
  write: (href: string, options: NavigationOptions) => void;
  render: (commit: Commit) => void;
  present: (commit: Commit, href: string, from: string, isCurrent: () => boolean) => Promise<void>;
  error: (error: unknown) => void;
}) {
  let current: string | undefined;
  let sequence = 0;
  let prepare: Prepare = async () => {};
  const listeners = new Set<Commit>();
  const snapshot = () => current ??= deps.read();
  const configure = (next: Prepare) => {
    ++sequence;
    prepare = next;
    return () => {
      if (prepare === next) {
        ++sequence;
        prepare = async () => {};
      }
    };
  };
  const navigate = async (href: string, options: NavigationOptions = {}, traversed = false) => {
    const from = snapshot();
    const request = ++sequence;
    if (href === from) return;
    try {
      const commitAccess = await prepare(href, from);
      if (request !== sequence) return;
      await deps.present(() => {
        if (request !== sequence) return;
        commitAccess?.();
        deps.render(() => {
          if (!traversed) deps.write(href, options);
          current = href;
          listeners.forEach(listener => listener());
        });
      }, href, from, () => request === sequence);
    } catch (error) {
      if (request !== sequence) return;
      if (traversed) deps.write(from, { replace: true });
      deps.error(error);
    }
  };
  return {
    snapshot, navigate, configure,
    subscribe(listener: Commit) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

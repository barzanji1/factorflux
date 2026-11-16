export function samePermissions(previous: readonly string[], next: readonly string[]) {
  return previous.length === next.length && previous.every(permission => next.includes(permission));
}

/** Coalesce background checks and discard results from replaced sessions. */
export function createPermissionRefresh<T>() {
  let generation = 0;
  let pending: { identity: string; promise: Promise<void> } | undefined;
  return {
    invalidate() {
      ++generation;
      pending = undefined;
    },
    run(identity: string, load: () => Promise<T>, commit: (value: T) => void, fail: (error: unknown) => void) {
      if (pending?.identity === identity) return pending.promise;
      const request = ++generation;
      const promise = (async () => {
        try {
          const value = await Promise.resolve().then(load);
          if (generation === request) commit(value);
        } catch (error) {
          if (generation === request) fail(error);
        } finally {
          if (generation === request) pending = undefined;
        }
      })();
      pending = { identity, promise };
      return promise;
    },
  };
}

/**
 * An in-process cache for the small public reference lists, categories and
 * programs, that the project listing reads on every visit (#558).
 *
 * Per task and time-bounded, not invalidated fleet-wide: a writer clears the
 * cache on the task that handled the write, and every other task serves the
 * old list until its entry expires. ADR-0048 has the trade.
 *
 * The TTL comes from `REFERENCE_LIST_CACHE_TTL_MS`, read on every lookup, and
 * unset or anything but a positive integer means no caching at all. Off by
 * default on purpose: the E2E and accessibility suites insert categories and
 * programs straight into the database behind a running server, which is the
 * "other task" case, and would read a stale list if the server cached.
 * `infra/ecs.tf` turns it on in production.
 *
 * Caches the promise rather than the rows, so a burst of cold misses on one
 * task shares one query instead of each taking a connection. A rejected load
 * is dropped at once, so a failed query is never served from the cache.
 */

const DIGITS = /^\d+$/;

export function referenceListTtlMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.REFERENCE_LIST_CACHE_TTL_MS;
  if (!(raw && DIGITS.test(raw))) {
    return 0;
  }
  return Number(raw);
}

interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

export interface ReferenceListCache<T> {
  clear: () => void;
  get: (key: string, load: () => Promise<T>) => Promise<T>;
}

const registry = new Set<ReferenceListCache<unknown>>();

export function createReferenceListCache<T>(
  ttlMs: () => number = referenceListTtlMs,
  now: () => number = Date.now
): ReferenceListCache<T> {
  const entries = new Map<string, Entry<T>>();

  const cache: ReferenceListCache<T> = {
    get(key, load) {
      const ttl = ttlMs();
      if (ttl <= 0) {
        return load();
      }
      const at = now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > at) {
        return hit.value;
      }
      const value = load();
      const entry = { expiresAt: at + ttl, value };
      entries.set(key, entry);
      value.catch(() => {
        // Only this entry: a clear and a fresh load may have replaced it.
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
  registry.add(cache as ReferenceListCache<unknown>);
  return cache;
}

/**
 * Empties every cache this module has made. For `resetDatabase()` in the
 * integration setup, which truncates under a cache that would otherwise
 * outlive the rows it holds.
 */
export function clearAllReferenceListCaches(): void {
  for (const cache of registry) {
    cache.clear();
  }
}

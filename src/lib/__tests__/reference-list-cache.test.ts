import { describe, expect, it, vi } from "vitest";
import {
  clearAllReferenceListCaches,
  createReferenceListCache,
  referenceListTtlMs,
} from "../_internal/reference-list-cache";

function clock(start = 0) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe("referenceListTtlMs", () => {
  it("is off unless the variable is a whole number of milliseconds", () => {
    expect(referenceListTtlMs({})).toBe(0);
    expect(referenceListTtlMs({ REFERENCE_LIST_CACHE_TTL_MS: "" })).toBe(0);
    expect(referenceListTtlMs({ REFERENCE_LIST_CACHE_TTL_MS: "60s" })).toBe(0);
    expect(referenceListTtlMs({ REFERENCE_LIST_CACHE_TTL_MS: "-5" })).toBe(0);
    expect(referenceListTtlMs({ REFERENCE_LIST_CACHE_TTL_MS: "60000" })).toBe(
      60_000
    );
  });
});

describe("createReferenceListCache", () => {
  it("reads through on every call when the TTL is zero", async () => {
    const cache = createReferenceListCache<number>(() => 0);
    const load = vi.fn(async () => 1);
    await cache.get("k", load);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves a hit until the TTL runs out, then loads again", async () => {
    const time = clock();
    const cache = createReferenceListCache<number>(() => 1000, time.now);
    let version = 1;
    const load = vi.fn(async () => version);

    expect(await cache.get("k", load)).toBe(1);
    version = 2;
    time.advance(999);
    expect(await cache.get("k", load)).toBe(1);
    time.advance(1);
    expect(await cache.get("k", load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart", async () => {
    const cache = createReferenceListCache<string>(() => 1000, clock().now);
    expect(await cache.get("project|", async () => "p")).toBe("p");
    expect(await cache.get("inventory|", async () => "i")).toBe("i");
    expect(await cache.get("project|", async () => "stale?")).toBe("p");
  });

  it("shares one load between concurrent misses", async () => {
    // The point of caching the promise: a burst of cold requests on one task
    // is one query and one connection, not one each.
    const cache = createReferenceListCache<number>(() => 1000, clock().now);
    let resolve: (value: number) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        })
    );
    const first = cache.get("k", load);
    const second = cache.get("k", load);
    resolve(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed load", async () => {
    const cache = createReferenceListCache<number>(() => 1000, clock().now);
    await expect(
      cache.get("k", () => Promise.reject(new Error("acquire timeout")))
    ).rejects.toThrow("acquire timeout");
    expect(await cache.get("k", async () => 3)).toBe(3);
  });

  it("does not let a stale failure evict the load that replaced it", async () => {
    const cache = createReferenceListCache<number>(() => 1000, clock().now);
    let reject: (error: Error) => void = () => undefined;
    const failing = cache.get(
      "k",
      () =>
        new Promise<number>((_, r) => {
          reject = r;
        })
    );
    cache.clear();
    expect(await cache.get("k", async () => 5)).toBe(5);
    reject(new Error("late"));
    await expect(failing).rejects.toThrow("late");
    const load = vi.fn(async () => 6);
    expect(await cache.get("k", load)).toBe(5);
    expect(load).not.toHaveBeenCalled();
  });

  it("forgets everything on clear, and so does the module-wide clear", async () => {
    const a = createReferenceListCache<string>(() => 1000, clock().now);
    const b = createReferenceListCache<string>(() => 1000, clock().now);
    await a.get("k", async () => "a1");
    await b.get("k", async () => "b1");

    a.clear();
    expect(await a.get("k", async () => "a2")).toBe("a2");
    expect(await b.get("k", async () => "b2")).toBe("b1");

    clearAllReferenceListCaches();
    expect(await a.get("k", async () => "a3")).toBe("a3");
    expect(await b.get("k", async () => "b3")).toBe("b3");
  });
});

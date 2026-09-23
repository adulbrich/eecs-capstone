import { describe, expect, it } from "vitest";
import {
  createTrafficWriter,
  type TrafficEventRow,
  type TrafficStore,
} from "#/server/_internal/traffic-writer";

const VIEWER = "198.51.100.7";
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function fakeStore(insert?: (row: TrafficEventRow) => Promise<void>) {
  const rows: TrafficEventRow[] = [];
  const store: TrafficStore = {
    insert:
      insert ??
      ((row) => {
        rows.push(row);
        return Promise.resolve();
      }),
    salt: () => Promise.resolve("test-salt"),
  };
  return { rows, store };
}

function post(
  body: unknown = { kind: "view", pathname: "/projects" },
  headers: Record<string, string> = {}
): Request {
  return new Request("http://eecs.example/api/traffic", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "user-agent": BROWSER,
      "x-forwarded-for": VIEWER,
      ...headers,
    },
  });
}

function writer(store: TrafficStore, maxInFlight?: number) {
  return createTrafficWriter({
    maxInFlight,
    now: () => new Date("2026-09-22T18:00:00Z"),
    store,
    trustedProxies: ["10.0.0.0/16"],
  });
}

describe("the traffic writer", () => {
  it("writes one row and answers 204 with no body and no cookie", async () => {
    const { rows, store } = fakeStore();
    const response = await writer(store)(
      post(
        {
          kind: "view",
          pathname: "/projects",
          referrer: "https://www.google.com/search?q=x",
          search: { q: "robot" },
        },
        { "cloudfront-viewer-country": "US" }
      )
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "view",
      pathname: "/projects",
      referrerHost: "www.google.com",
      country: "US",
      browser: "Chrome",
      os: "Windows",
      device: "desktop",
      search: { q: "robot" },
      previousPath: null,
    });
  });

  it("never stores the address or the raw user agent", async () => {
    const { rows, store } = fakeStore();
    await writer(store)(post());
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(VIEWER);
    expect(stored).not.toContain(BROWSER);
    expect(stored).not.toContain("128.0");
  });

  it("stores null for a forged or duplicated country", async () => {
    const { rows, store } = fakeStore();
    await writer(store)(
      post(undefined, { "cloudfront-viewer-country": "usa" })
    );
    await writer(store)(
      post(undefined, { "cloudfront-viewer-country": "US, GB" })
    );
    expect(rows.map((r) => r.country)).toEqual([null, null]);
  });

  it.each([
    [
      "a cross-site request",
      post(undefined, { "sec-fetch-site": "cross-site" }),
    ],
    [
      "a request with no Sec-Fetch-Site",
      post(undefined, { "sec-fetch-site": "" }),
    ],
    ["an oversized body", post("x".repeat(5000))],
    ["a body that is not JSON", post("{nope")],
    ["an invalid body", post({ kind: "click", pathname: "/projects" })],
    ["a bot", post(undefined, { "user-agent": "Googlebot/2.1" })],
    ["no user agent", post(undefined, { "user-agent": "" })],
    ["no resolvable address", post(undefined, { "x-forwarded-for": "" })],
  ])("drops %s and still answers 204", async (_, request) => {
    const { rows, store } = fakeStore();
    const response = await writer(store)(request);
    expect(response.status).toBe(204);
    expect(rows).toHaveLength(0);
  });

  it("drops an event gone stale waiting for its salt, so the rollup cannot miss it", async () => {
    const { rows, store } = fakeStore();
    const times = [0, 31_000].map(
      (ms) => new Date(Date.UTC(2026, 8, 22, 18) + ms)
    );
    const handle = createTrafficWriter({
      now: () => times.shift() ?? new Date(),
      store,
      trustedProxies: ["10.0.0.0/16"],
    });
    expect((await handle(post())).status).toBe(204);
    expect(rows).toHaveLength(0);
  });

  it("keeps an event whose salt arrives within the allowed lag", async () => {
    const { rows, store } = fakeStore();
    const times = [0, 29_000].map(
      (ms) => new Date(Date.UTC(2026, 8, 22, 18) + ms)
    );
    const handle = createTrafficWriter({
      now: () => times.shift() ?? new Date(),
      store,
      trustedProxies: ["10.0.0.0/16"],
    });
    await handle(post());
    expect(rows).toHaveLength(1);
  });

  it("answers 204 when the client hangs up mid-body", async () => {
    const { rows, store } = fakeStore();
    const aborted = new Request("http://eecs.example/api/traffic", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("client went away"));
        },
      }),
      duplex: "half",
      headers: { "sec-fetch-site": "same-origin", "user-agent": BROWSER },
    } as RequestInit);
    expect((await writer(store)(aborted)).status).toBe(204);
    expect(rows).toHaveLength(0);
  });

  it("drops rather than waits once the in-flight cap is reached", async () => {
    let started = 0;
    const never = new Promise<void>(() => undefined);
    const { store } = fakeStore(() => {
      started += 1;
      return never;
    });
    const handle = writer(store, 5);
    for (let i = 0; i < 5; i++) {
      handle(post());
    }
    // Let the five reach the insert before the sixth arrives.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sixth = await handle(post());
    expect(sixth.status).toBe(204);
    expect(started).toBe(5);
  });

  it("frees a slot when an insert fails, and logs no address", async () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (message: string) => logged.push(message);
    try {
      const rows: TrafficEventRow[] = [];
      let fail = true;
      const { store } = fakeStore((row) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("connection terminated"));
        }
        rows.push(row);
        return Promise.resolve();
      });
      const handle = writer(store, 1);
      expect((await handle(post())).status).toBe(204);
      await handle(post());
      expect(rows).toHaveLength(1);
      expect(logged.join("\n")).toContain("connection terminated");
      expect(logged.join("\n")).not.toContain(VIEWER);
    } finally {
      console.error = original;
    }
  });
});

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { trafficEvents, trafficSalt } from "#/db/schema";
import { trafficDb } from "#/db/traffic";
import {
  createSaltStore,
  createTrafficWriter,
  type TrafficStore,
  trafficStore,
} from "#/server/_internal/traffic-writer";

const VIEWER = "198.51.100.7";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

function post(
  body: unknown = { kind: "view", pathname: "/projects" },
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost:3000/api/traffic", {
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

function writer(
  store: TrafficStore = trafficStore(trafficDb),
  maxInFlight = 5
) {
  return createTrafficWriter({
    maxInFlight,
    store,
    trustedProxies: ["10.0.0.0/16"],
  });
}

async function rows() {
  return await db.select().from(trafficEvents);
}

describe("POST /api/traffic against the database", () => {
  it("inserts one row for a valid anonymous same-origin POST and answers 204", async () => {
    const response = await writer()(
      post({
        kind: "view",
        pathname: "/projects",
        referrer: "https://www.google.com/search?q=capstone",
        search: { q: "robot", categories: [], page: 1 },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "view",
      pathname: "/projects",
      referrerHost: "www.google.com",
      search: { q: "robot", categories: [], page: 1 },
      browser: "Safari",
      os: "macOS",
      device: "desktop",
      country: null,
    });
    expect(stored[0].visitorHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never stores the request's address", async () => {
    await writer()(post());
    const [row] = await rows();
    expect(JSON.stringify(row)).not.toContain(VIEWER);
  });

  it.each([
    [
      "a cross-site POST",
      () => post(undefined, { "sec-fetch-site": "cross-site" }),
    ],
    ["an oversized body", () => post("x".repeat(5000))],
    ["an invalid body", () => post({ kind: "view", pathname: "projects" })],
    [
      "an isbot user agent",
      () => post(undefined, { "user-agent": "Googlebot/2.1" }),
    ],
  ])("answers 204 to %s and inserts nothing", async (_, request) => {
    const response = await writer()(request());
    expect(response.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it("drops rather than waits once the in-flight cap is reached", async () => {
    const real = trafficStore(trafficDb);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: TrafficStore = {
      salt: real.salt,
      insert: async (row) => {
        await gate;
        await real.insert(row);
      },
    };
    const handle = writer(gated, 2);
    const held = [handle(post()), handle(post())];
    await new Promise((resolve) => setTimeout(resolve, 50));
    const dropped = await handle(post());
    expect(dropped.status).toBe(204);
    release();
    await Promise.all(held);
    expect(await rows()).toHaveLength(2);
  });
});

describe("the traffic salt", () => {
  it("is an UNLOGGED table, so backups and restores never hold a salt", async () => {
    const result = await db.execute(
      sql`SELECT relpersistence FROM pg_class WHERE relname = 'traffic_salt'`
    );
    expect(result.rows[0]).toEqual({ relpersistence: "u" });
  });

  it("holds one row and refuses a second", async () => {
    await expect(
      db.insert(trafficSalt).values({ id: 2, day: "2026-09-22", salt: "x" })
    ).rejects.toThrow();
  });

  it("is created on the first request and reused for the rest of the day", async () => {
    const salt = createSaltStore(trafficDb);
    const first = await salt("2026-09-22");
    expect(first).toHaveLength(43);
    expect(await createSaltStore(trafficDb)("2026-09-22")).toBe(first);
    expect(await db.select().from(trafficSalt)).toEqual([
      { id: 1, day: "2026-09-22", salt: first },
    ]);
  });

  it("is replaced, not kept beside, on a new local day", async () => {
    const yesterday = await createSaltStore(trafficDb)("2026-09-22");
    const today = await createSaltStore(trafficDb)("2026-09-23");
    expect(today).not.toBe(yesterday);
    expect(await db.select().from(trafficSalt)).toEqual([
      { id: 1, day: "2026-09-23", salt: today },
    ]);
  });

  it("is not rotated back by a task whose clock runs behind", async () => {
    const today = await createSaltStore(trafficDb)("2026-09-23");
    expect(await createSaltStore(trafficDb)("2026-09-22")).toBe(today);
    expect(await db.select().from(trafficSalt)).toHaveLength(1);
  });

  it("agrees across tasks that race to rotate it", async () => {
    await createSaltStore(trafficDb)("2026-09-22");
    // Open every pooled connection first, so the four reads below run side by
    // side and each sees yesterday's row before any rotation commits. Without
    // that, the first store can finish before the others connect and the
    // race never happens.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        trafficDb.execute(sql`SELECT pg_sleep(0.05)`)
      )
    );
    // Separate stores stand in for separate tasks, each with its own cache.
    const salts = await Promise.all(
      Array.from({ length: 4 }, () => createSaltStore(trafficDb)("2026-09-23"))
    );
    expect(new Set(salts).size).toBe(1);
    expect(await db.select().from(trafficSalt)).toEqual([
      { id: 1, day: "2026-09-23", salt: salts[0] },
    ]);
  });
});

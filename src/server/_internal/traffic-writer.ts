import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { isbot } from "isbot";
import { trafficEvents, trafficSalt } from "#/db/schema";
import type { TrafficDb } from "#/db/traffic";
import { CONNECTION_BUDGET } from "#/lib/_internal/db-pool";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  describeAgent,
  readCappedBody,
  referrerHost,
  type TrafficRequestBody,
  trafficBodySchema,
  viewerAddress,
  viewerCountry,
  visitorHash,
} from "#/lib/_internal/traffic-request";
import { localDay } from "#/lib/day-range";

/**
 * The traffic writer (#591): turns one POST to `/api/traffic` into at most
 * one `traffic_events` row. Never imports `better-auth` or `#/lib/auth`, and
 * never reads the session cookie; `traffic-privacy.test.ts` holds the import
 * graph to that.
 */

export type TrafficEventRow = typeof trafficEvents.$inferInsert;

/** What the writer needs from the database, so a test can stand in for it. */
export interface TrafficStore {
  insert: (row: TrafficEventRow) => Promise<void>;
  /** The salt for `day`, a local `YYYY-MM-DD` in the office's zone. */
  salt: (day: string) => Promise<string>;
}

export interface TrafficWriterOptions {
  maxInFlight?: number;
  now?: () => Date;
  store: TrafficStore;
  trustedProxies: readonly string[];
}

/**
 * Always the answer, whatever happened: a rejection, a drop and a write look
 * the same from outside, so a script learns nothing by probing. No body and
 * no cookie.
 */
function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * The body, when the request is same-origin, under the size cap, JSON and
 * valid; otherwise null.
 */
async function acceptedBody(
  request: Request
): Promise<TrafficRequestBody | null> {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return null;
  }
  const text = await readCappedBody(request);
  if (text === null) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = trafficBodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * The handler. Each check drops the event and still answers 204, in the
 * order #510 settled: same-origin, body cap, schema, bot, in-flight cap.
 *
 * The cap counts events, not connections. On the first request of a day
 * the salt rotation holds one connection while other events insert, so the
 * pool can briefly see one more demand than it has, and that one waits at
 * most the pool's acquire timeout. Bounded and once a day, so left alone.
 */
export function createTrafficWriter({
  maxInFlight = CONNECTION_BUDGET.trafficPerTask,
  now = () => new Date(),
  store,
  trustedProxies,
}: TrafficWriterOptions): (request: Request) => Promise<Response> {
  let inFlight = 0;

  return async (request) => {
    const body = await acceptedBody(request);
    if (!body) {
      return noContent();
    }
    // A real browser always sends a user agent, and `bowser` refuses an
    // empty one, so a missing header is treated as a bot.
    const userAgent = request.headers.get("user-agent") ?? "";
    if (!userAgent || isbot(userAgent)) {
      return noContent();
    }
    // Drop rather than queue: the pool has `maxInFlight` connections, and a
    // waiting request would hold its socket for nothing (ADR-0034).
    if (inFlight >= maxInFlight) {
      return noContent();
    }
    const address = viewerAddress(
      request.headers.get("x-forwarded-for"),
      trustedProxies
    );
    if (!address) {
      return noContent();
    }

    inFlight += 1;
    try {
      const at = now();
      const agent = describeAgent(userAgent);
      await store.insert({
        occurredAt: at,
        kind: body.kind,
        visitorHash: visitorHash(
          await store.salt(localDay(at)),
          address,
          agent
        ),
        pathname: body.pathname,
        search: body.search ?? null,
        referrerHost: referrerHost(body.referrer, new URL(request.url).host),
        previousPath: body.previousPath ?? null,
        country: viewerCountry(
          request.headers.get("cloudfront-viewer-country")
        ),
        browser: agent.browser,
        os: agent.os,
        device: agent.device,
      });
    } catch (error) {
      // A string, never the error: a query error carries its parameters,
      // and those hold the day's salt (redact-query-error.ts).
      console.error(
        `Traffic writer dropped an event: ${redactQueryError(error)}`
      );
    } finally {
      inFlight -= 1;
    }
    return noContent();
  };
}

/**
 * Reads the day's salt, replacing it on the first request of a new local
 * day. Each task caches the value in memory keyed by day, and the promise
 * rather than the value, so concurrent first requests in one task share one
 * read.
 */
export function createSaltStore(
  db: TrafficDb
): (day: string) => Promise<string> {
  let cached: { day: string; salt: Promise<string> } | null = null;
  return (day) => {
    if (cached?.day !== day) {
      const salt = loadSalt(db, day);
      const entry = { day, salt };
      cached = entry;
      salt.catch(() => {
        if (cached === entry) {
          cached = null;
        }
      });
    }
    return cached.salt;
  };
}

/**
 * The stored salt when it is today's, or a new one.
 *
 * Rotation is `TRUNCATE` then `INSERT` under an exclusive lock, and the row is
 * read again once the lock is held, so tasks racing to rotate agree: the
 * first writes, the rest find its value. A row dated after `day` is used as
 * it is, because only a task whose clock runs behind can see one, and
 * rotating back would split every visitor of the new day.
 */
async function loadSalt(db: TrafficDb, day: string): Promise<string> {
  const [row] = await db
    .select()
    .from(trafficSalt)
    .where(eq(trafficSalt.id, 1));
  if (row && row.day >= day) {
    return row.salt;
  }
  return await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${trafficSalt} IN ACCESS EXCLUSIVE MODE`);
    const [current] = await tx
      .select()
      .from(trafficSalt)
      .where(eq(trafficSalt.id, 1));
    if (current && current.day >= day) {
      return current.salt;
    }
    const salt = randomBytes(32).toString("base64url");
    await tx.execute(sql`TRUNCATE TABLE ${trafficSalt}`);
    await tx.insert(trafficSalt).values({ id: 1, day, salt });
    return salt;
  });
}

/** The store over the traffic writer's own pool. */
export function trafficStore(db: TrafficDb): TrafficStore {
  return {
    insert: async (row) => {
      await db.insert(trafficEvents).values(row);
    },
    salt: createSaltStore(db),
  };
}

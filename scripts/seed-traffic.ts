/**
 * Fills `traffic_events` with 1,000,000 plausible rows for timing the
 * `/admin/traffic` queries (#592). Development only: it refuses any
 * database that is not on this machine, and it deletes the traffic rows and
 * their rollup first, so run it on a scratch database or accept losing local
 * traffic.
 *
 *   npm run db:seed:traffic
 *
 * One SQL statement does the work, so it takes seconds rather than a
 * million round trips. It generates visits rather than events: each visit
 * has one visitor hash, a start in the last 365 days (office hours weighted
 * over nights), and a run of events a few minutes apart, so the 30-minute
 * visit rule has real gaps to find. Project pages point at the ids of
 * published projects when the seed has any, so views per project joins.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const ROWS = 1_000_000;
const VISITS = 360_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const url = new URL(process.env.DATABASE_URL ?? "postgres://unset");
if (!LOCAL_HOSTS.has(url.hostname)) {
  throw new Error(
    `Refusing to seed traffic into ${url.hostname}: this script is for a local database.`
  );
}

const started = Date.now();
// The rollup is derived from the events, so it goes with them.
await db.execute(sql`TRUNCATE TABLE traffic_events, traffic_visits`);
await db.execute(sql`
  WITH project_ids AS (
    SELECT coalesce(
      array_agg(id::text) FILTER (WHERE status = 'published' AND deleted_at IS NULL),
      ARRAY['00000000-0000-0000-0000-000000000000']
    ) AS ids
    FROM projects
  ),
  visits AS (
    SELECT
      v,
      -- A visitor makes about 1.3 visits, all on one day, since the salt
      -- makes a later day's return a new visitor.
      md5('visitor' || (v / 13 * 10 + (v % 13) % 10)::text) AS visitor,
      date_trunc('day', now() - random() * interval '365 days')
        + interval '7 hours'
        + (power(random(), 0.8) * interval '15 hours') AS start,
      -- Geometric-ish: most visits are one to three events, a few run long.
      1 + floor(-ln(1 - random() * 0.999) * 2.3)::int AS events,
      (ARRAY['US','US','US','US','US','CA','IN','CN','DE','GB','MX',NULL])[1 + floor(random() * 12)::int] AS country,
      (ARRAY['Chrome','Chrome','Chrome','Safari','Safari','Firefox','Microsoft Edge'])[1 + floor(random() * 7)::int] AS browser,
      (ARRAY['Windows','macOS','macOS','iOS','Android','Linux','ChromeOS'])[1 + floor(random() * 7)::int] AS os,
      (ARRAY['desktop','desktop','desktop','mobile','mobile','tablet'])[1 + floor(random() * 6)::int]::traffic_device AS device,
      (ARRAY[NULL,NULL,NULL,'www.google.com','www.bing.com','canvas.oregonstate.edu','eecs.oregonstate.edu','www.linkedin.com','duckduckgo.com'])[1 + floor(random() * 9)::int] AS referrer
    FROM generate_series(1, ${VISITS}) AS v
  ),
  events AS (
    SELECT
      visits.*,
      k,
      visits.start + (k - 1) * (interval '20 seconds' + random() * interval '6 minutes') AS at,
      random() AS roll,
      (SELECT ids FROM project_ids) AS ids
    FROM visits, LATERAL generate_series(1, visits.events) AS k
  )
  INSERT INTO traffic_events
    (occurred_at, kind, visitor_hash, pathname, search, referrer_host,
     previous_path, country, browser, os, device)
  SELECT
    at,
    CASE WHEN k > 1 AND roll < 0.25 THEN 'search' ELSE 'view' END::traffic_event_kind,
    visitor,
    CASE
      WHEN k > 1 AND roll < 0.25 THEN (ARRAY['/projects','/projects','/inventory'])[1 + floor(random() * 3)::int]
      WHEN roll < 0.45 THEN '/projects/' || ids[1 + floor(random() * cardinality(ids))::int]
      WHEN roll < 0.65 THEN '/projects'
      WHEN roll < 0.80 THEN '/'
      WHEN roll < 0.90 THEN '/inventory'
      WHEN roll < 0.98 THEN '/inventory/' || md5((v % 400)::text)::uuid::text
      ELSE '/privacy'
    END,
    CASE
      WHEN roll < 0.25 OR (roll >= 0.45 AND roll < 0.65) THEN jsonb_build_object(
        'q', CASE WHEN random() < 0.3 THEN (ARRAY['robot','web','machine learning','game','security','mobile app'])[1 + floor(random() * 6)::int] ELSE '' END,
        'categories', '[]'::jsonb,
        'program', NULL,
        'archivedOnly', random() < 0.05,
        'acceptingOnly', random() < 0.2,
        'studentProposedOnly', random() < 0.1,
        'requiresNdaOnly', false,
        'page', 1 + floor(power(random(), 4) * 4)::int,
        'view', CASE WHEN random() < 0.15 THEN 'table' ELSE NULL END
      )
      ELSE NULL
    END,
    CASE WHEN k = 1 THEN referrer END,
    CASE WHEN k > 1 THEN '/projects' END,
    country,
    browser,
    os,
    device
  FROM events
  WHERE at < now()
  LIMIT ${ROWS}
`);
// VACUUM too, not only ANALYZE: fresh rows have no visibility map bits, so an
// index-only scan would still visit the heap and the timings would lie.
await db.execute(sql`VACUUM ANALYZE traffic_events`);
const [{ n }] = (
  await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM traffic_events`)
).rows;
console.log(`traffic_events: ${n} rows in ${Date.now() - started} ms`);
process.exit(0);

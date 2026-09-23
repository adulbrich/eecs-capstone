/**
 * Times every `/admin/traffic` query against the local database, for the
 * 200 ms budget on #592. Seed first with `npm run db:seed:traffic`.
 *
 *   npm run db:explain:traffic            # the last 90 days
 *   npm run db:explain:traffic -- 30      # the last 30
 *
 * Imports the query builders the page runs, so it measures the shipped SQL
 * rather than a copy. Each query runs once to warm the cache and once under
 * EXPLAIN (ANALYZE, BUFFERS); the plan of the second run is printed.
 */
import { type SQL, sql } from "drizzle-orm";
import { db } from "../src/db";
import { comparisonPeriods, localDay, shiftDay } from "../src/lib/day-range";
import {
  dailyQuery,
  entriesQuery,
  filterUseQuery,
  pagesQuery,
  rollUpTrafficVisits,
  visitsInRange,
} from "../src/server/_internal/traffic";

const days = Number(process.argv[2] ?? 90);
const now = new Date();
const to = localDay(now);
const from = shiftDay(to, 1 - days);
const p = comparisonPeriods(from, to);

const [{ n }] = (
  await db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM traffic_events`)
).rows;
const [{ inRange }] = (
  await db.execute<{ inRange: string }>(
    sql`SELECT count(*) AS "inRange" FROM traffic_events WHERE day >= ${from}::date AND day <= ${to}::date`
  )
).rows;
console.log(`${n} rows in traffic_events, ${inRange} from ${from} to ${to}`);

// The first load after a backlog rolls every closed day up at once; later
// loads roll up one day or none. Both are timed, the second as the page
// usually meets it.
for (const load of ["first load", "next load"]) {
  const started = Date.now();
  await rollUpTrafficVisits(now);
  console.log(`rollup, ${load}: ${Date.now() - started} ms`);
}
const [{ visits }] = (
  await db.execute<{ visits: string }>(
    sql`SELECT count(*) AS visits FROM traffic_visits WHERE day >= ${from}::date AND day <= ${to}::date`
  )
).rows;
console.log(`${visits} rolled-up visits in range\n`);

const current = visitsInRange(from, to, now);
const queries: Record<string, SQL> = {
  daily: dailyQuery(current),
  "daily, previous period": dailyQuery(
    visitsInRange(p.range.previousFrom, p.range.previousTo, now)
  ),
  pages: pagesQuery(current),
  entries: entriesQuery(current),
  filterUse: filterUseQuery(current),
};
const results: string[] = [];
for (const [name, query] of Object.entries(queries)) {
  await db.execute(query);
  const plan = (
    await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${query}`)
  ).rows.map((row) => Object.values(row)[0] as string);
  const time = plan.find((line) => line.startsWith("Execution Time"));
  results.push(`${name}: ${time}`);
  console.log(`=== ${name}\n${plan.join("\n")}\n`);
}
console.log(results.join("\n"));
process.exit(0);

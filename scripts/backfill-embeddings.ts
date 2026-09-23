/**
 * Workstation sweeper for missing or stale project embeddings, calling the
 * app's own writer so there is nothing to keep in sync.
 *
 * `scripts/backfill-embeddings.mjs` is the production equivalent: this file
 * imports from `src/` and needs `tsx`, and the runtime image has neither.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-embeddings.ts
 */
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { projects } from "../src/db/schema";
import {
  EMBEDDABLE_STATUSES,
  refreshProjectEmbedding,
} from "../src/server/_internal/project-embeddings";

const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(
      and(
        inArray(projects.status, [...EMBEDDABLE_STATUSES]),
        isNull(projects.deletedAt)
      )
    );

  const tally = {
    cleared: 0,
    failed: 0,
    skipped: 0,
    superseded: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const row of rows) {
    const outcome = await refreshProjectEmbedding(row.id);
    tally[outcome] += 1;
    process.stdout.write(`${outcome.padEnd(10)} ${row.title}\n`);
    // "failed" as well as "updated". A throttled Bedrock call fails in
    // milliseconds, so sleeping only on success lets exactly the run that is
    // being throttled burst through every row. "failed" also covers errors
    // before Bedrock, a dead connection say, which over-sleeps rather than
    // under-sleeps and is the safe direction. "unchanged" and "skipped" never
    // reach Bedrock at all, and delaying those would add two minutes to a
    // sweep that does nothing.
    if (outcome === "updated" || outcome === "failed" || outcome === "superseded") {
      await sleep(DELAY_MS);
    }
  }

  process.stdout.write(
    `\n${rows.length} embeddable projects: ${tally.updated} updated, ` +
      `${tally.unchanged} already current, ${tally.failed} failed, ` +
      `${tally.skipped} skipped.\n`
  );

  if (tally.failed > 0) {
    process.stdout.write(
      "Failures are safe to retry: re-run this script once Bedrock access is working.\n"
    );
    process.exit(1);
  }
  process.exit(0);
}

await main();

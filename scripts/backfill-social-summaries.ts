/**
 * Workstation sweeper for missing or stale social summaries, calling the app's
 * own writer so there is nothing to keep in sync.
 *
 * `scripts/backfill-social-summaries.mjs` is the production equivalent: this
 * file imports from `src/` and needs `tsx`, and the runtime image has neither.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-social-summaries.ts
 *   LIMIT=25 npx tsx --env-file=.env.local scripts/backfill-social-summaries.ts
 *   DRY_RUN=1 npx tsx --env-file=.env.local scripts/backfill-social-summaries.ts
 *
 * `DRY_RUN` counts what would be written and calls nothing. `LIMIT` caps the
 * rows attempted. Both exist because this sweep is one paid model call per
 * project and the catalog carries hundreds of legacy imports, unlike the
 * embedding sweep where a re-run is cheap enough not to need a rehearsal.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { projects } from "../src/db/schema";
import { EMBEDDABLE_STATUSES } from "../src/server/_internal/project-embeddings";
import { refreshSocialSummary } from "../src/server/_internal/project-social-summary";

const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const limit = Number(process.env.LIMIT ?? "0");
  const dryRun = !!process.env.DRY_RUN;

  const rows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(
      and(
        inArray(projects.status, [...EMBEDDABLE_STATUSES]),
        isNull(projects.deletedAt)
      )
    );
  const targets = limit > 0 ? rows.slice(0, limit) : rows;

  // Printed before the first call, not after the run: an operator about to
  // spend hundreds of model calls should see the number while they can still
  // stop it.
  process.stdout.write(
    `${rows.length} summarisable projects, attempting ${targets.length}` +
      `${dryRun ? " (dry run, nothing will be written)" : ""}.\n\n`
  );
  if (dryRun) {
    process.exit(0);
  }

  const tally = {
    failed: 0,
    manual: 0,
    skipped: 0,
    unchanged: 0,
    updated: 0,
  };

  for (const row of targets) {
    const outcome = await refreshSocialSummary(row.id);
    tally[outcome] += 1;
    process.stdout.write(`${outcome.padEnd(9)} ${row.title}\n`);
    // The same rule the embedding sweeper uses, and for the same reason: a
    // throttled call fails in milliseconds, so sleeping only on success lets
    // exactly the run being throttled burst through every row. The other three
    // outcomes never reach Bedrock at all.
    if (outcome === "updated" || outcome === "failed") {
      await sleep(DELAY_MS);
    }
  }

  process.stdout.write(
    `\n${targets.length} attempted: ${tally.updated} updated, ` +
      `${tally.unchanged} already current, ${tally.manual} written by staff, ` +
      `${tally.failed} failed, ${tally.skipped} skipped.\n`
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

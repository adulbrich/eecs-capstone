import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { projects } from "../src/db/schema";
import { refreshProjectEmbedding } from "../src/server/_internal/project-embeddings";

const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.status, "published"), isNull(projects.deletedAt)));

  const tally = { updated: 0, unchanged: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    const outcome = await refreshProjectEmbedding(row.id);
    tally[outcome] += 1;
    process.stdout.write(`${outcome.padEnd(9)} ${row.title}\n`);
    if (outcome === "updated") {
      await sleep(DELAY_MS);
    }
  }

  process.stdout.write(
    `\n${rows.length} published projects: ${tally.updated} updated, ` +
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

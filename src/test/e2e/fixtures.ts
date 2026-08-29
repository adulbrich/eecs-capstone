/**
 * Database fixtures for the end-to-end suite.
 *
 * Rows that a test mutates are created by the test itself, on every attempt,
 * rather than once in global setup. The inventory flow walks one item through
 * `available -> requested -> reserved -> checked_out -> available`, so a test
 * that fails at "Check out" leaves the item `reserved`. A retry starting from
 * that state fails differently and hides the original failure. Global setup
 * cannot help, because it already ran before the first attempt.
 *
 * Every row this module creates is named with `E2E_PREFIX`, which is also what
 * `sweepOrphans` deletes. That is the self-healing half: rows left behind by a
 * run that died mid-flow are removed at the start of the next one.
 */
import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";

export const E2E_PREFIX = "E2E-";

export type Db = NodePgDatabase<typeof schema>;

/**
 * Callers are responsible for closing the pool. Tests open one per file rather
 * than sharing a module-level singleton, because Playwright runs each file in
 * its own worker process and a shared pool would leak a connection per worker.
 */
export function openDb(): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

/** A name no other run will collide with, swept by prefix on the next run. */
export function fixtureName(label: string): string {
  return `${E2E_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

export async function createFixtureItem(
  db: Db,
  name: string
): Promise<{ id: string; name: string }> {
  const [item] = await db
    .insert(schema.inventoryItems)
    .values({
      name,
      description: "Created by the smoke suite. Safe to delete.",
    })
    .returning();
  return { id: item.id, name: item.name };
}

/**
 * Deletes every `E2E-` row left behind by an earlier run.
 *
 * Order matters. `inventory_request_items.item_id` is the one FK in this graph
 * declared `onDelete: "restrict"`; every other reference to an item cascades.
 * So the request lines (and the requests holding them) have to go before the
 * items do, or the item delete is refused.
 */
export async function sweepOrphans(db: Db): Promise<void> {
  const staleItems = await db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(like(schema.inventoryItems.name, `${E2E_PREFIX}%`));

  if (staleItems.length > 0) {
    const itemIds = staleItems.map((i) => i.id);
    const lines = await db
      .select({ requestId: schema.inventoryRequestItems.requestId })
      .from(schema.inventoryRequestItems)
      .where(inArray(schema.inventoryRequestItems.itemId, itemIds));

    const requestIds = [...new Set(lines.map((l) => l.requestId))];
    if (requestIds.length > 0) {
      // Deleting the request cascades to its lines, including lines for items
      // this sweep is not touching. That is correct: a request created by the
      // suite belongs entirely to the suite.
      await db
        .delete(schema.inventoryRequests)
        .where(inArray(schema.inventoryRequests.id, requestIds));
    }

    await db
      .delete(schema.inventoryItems)
      .where(inArray(schema.inventoryItems.id, itemIds));
  }

  await db
    .delete(schema.projects)
    .where(like(schema.projects.title, `${E2E_PREFIX}%`));
}

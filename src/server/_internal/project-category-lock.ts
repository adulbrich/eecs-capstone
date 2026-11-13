import { sql } from "drizzle-orm";
import { projects } from "#/db/schema";
import type { Tx } from "./inventory-transitions";

// Alone, and importing nothing that reads a session, so the categorizer's
// automatic writer can take the lock without pulling Better Auth into the
// background refresh queue's imports (#31).

/**
 * Takes the project's row lock for the rest of `tx`. Every writer of a
 * project's category set takes it first, staff Save, Regenerate and the
 * categorizer's first write (#31), because a set is many rows and only the
 * project row is one thing to lock: without it, a Regenerate that has checked
 * the set and a Save still uncommitted both land, and the project carries the
 * union.
 */
export async function lockProjectCategories(tx: Tx, projectId: string) {
  await tx.execute(
    sql`select 1 from ${projects} where ${projects.id} = ${projectId} for update`
  );
}

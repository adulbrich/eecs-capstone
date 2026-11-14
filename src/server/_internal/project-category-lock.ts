import { inArray, sql } from "drizzle-orm";
import { projectCategories, projects } from "#/db/schema";
import type { Tx } from "./inventory-transitions";

// Alone, and importing nothing that reads a session, so the categorizer's
// automatic writer can take the lock without pulling Better Auth into the
// background refresh queue's imports (#31).
//
// The order: a project row before any category row. A Save, Regenerate and
// the categorizer lock the project and then take a key-share lock on each
// category they link, for its foreign key. A writer that deletes a category
// cascades onto its links, so it locks every project carrying the category
// first (`lockProjectsCarrying`), or it deadlocks against a Save that has
// deleted a link and is re-inserting it.

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

/**
 * The same lock on every project carrying one of `categoryIds`, in id order,
 * for a writer about to delete those categories. The set is read once, so a
 * project that links one of them after this read is not locked. A Save that
 * reaches the category after the writer has locked it waits and fails on the
 * deleted row. One that commits the link before then leaves a window: a
 * second Save of that project, re-inserting the link while the writer
 * deletes, can still deadlock against it, and Postgres aborts one side with
 * nothing half-written.
 */
export async function lockProjectsCarrying(tx: Tx, categoryIds: string[]) {
  if (categoryIds.length === 0) {
    return;
  }
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      inArray(
        projects.id,
        tx
          .select({ id: projectCategories.projectId })
          .from(projectCategories)
          .where(inArray(projectCategories.categoryId, categoryIds))
      )
    )
    .orderBy(projects.id)
    .for("update");
}

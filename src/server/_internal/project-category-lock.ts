import { inArray, sql } from "drizzle-orm";
import { categories, projectCategories, projects } from "#/db/schema";
import type { Tx } from "./inventory-transitions";

// Alone, and importing nothing that reads a session, so the categorizer's
// automatic writer can take the lock without pulling Better Auth into the
// background refresh queue's imports (#31).
//
// The order: a project row before any category row. A Save, Regenerate and
// the categorizer lock the project and then take a key-share lock on each
// category they add, for its foreign key, in id order. None of them deletes
// and re-inserts a link it keeps (`replaceProjectCategories` in
// `categories.ts`), so a category delete cascading onto that link waits on
// none of them (#864). A writer that deletes categories locks every project
// carrying them first (`lockProjectsCarrying`).

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
 * for a writer about to delete those categories. A cleanup merge needs it:
 * its insert into a carrier's links takes a key-share lock on the carrier's
 * row, which an unfinished Save of that carrier holds. A delete and a
 * retirement take it too, so every writer that deletes categories keeps one
 * order.
 *
 * The set is read once, so a project that gains one of these categories
 * after this read is not locked. A Save that reaches a category after the
 * writer has locked it waits and fails on the deleted row. A delete or a
 * retirement cannot deadlock against a Save of a project that gained the
 * category earlier; a merge still can, when that Save is in flight as the
 * merge reaches the project's links, and Postgres aborts one side with
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

/**
 * Takes the key-share lock a link's foreign key takes, ahead of the insert,
 * on each of `categoryIds` that still exists, in id order, and returns those
 * ids. A delete of one of them still in flight is waited out and the
 * category left out, where an insert that read `categories` first would see
 * it and then fail the foreign key once the delete committed (#864). Held to
 * the end of `tx`, so none of the rest can be deleted before the insert.
 */
export async function lockCategoriesToLink(
  tx: Tx,
  categoryIds: string[]
): Promise<string[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.id, categoryIds))
    .orderBy(categories.id)
    .for("key share");
  return rows.map((r) => r.id);
}

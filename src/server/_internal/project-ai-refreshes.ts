import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectAiRefreshes } from "#/db/schema";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  type AiRefreshAttempt,
  type AiRefreshKind,
  type AiRefreshTrigger,
  recordableOutcome,
} from "#/lib/ai-refresh";

/**
 * Records a writer's outcome as the project's last attempt at `kind` (#631),
 * overwriting the one before.
 *
 * Takes the writer's outcome whole and drops the ones that are not attempts:
 * `skipped` and `manual` make no attempt to write, and recording them would
 * add a row on every draft save. So a project with no row has no attempt on
 * record, which is what staff need to tell apart from "failed". "On record",
 * not "never attempted": a record write that fails below is logged and lost.
 *
 * `unchanged` is not recorded either, but it does retire a `failed` or
 * `superseded` row stamped before `startedAt`, the moment the writer read the
 * row: the stored output already matches the current text, as when an edit is
 * reverted after a failed attempt, and a failure left beside it would offer a
 * retry that has nothing to do.
 *
 * The upsert keeps the later stamp. A staff Recompute or Regenerate does not
 * share the background queue, so two attempts can commit in either order.
 *
 * Never throws, for the reason the writers never throw: the save or publish
 * has committed, and losing the record costs a status line, not the user's
 * action. Every caller awaits it before returning its own outcome, so a
 * test that settles the refresh reads the row.
 */
export async function recordAiRefresh(
  projectId: string,
  kind: AiRefreshKind,
  trigger: AiRefreshTrigger,
  writerOutcome: string,
  startedAt: Date
): Promise<void> {
  try {
    if (writerOutcome === "unchanged") {
      // Only rows stamped before this writer read the row: a staff attempt
      // that failed while it ran is newer than the check and stays.
      await db
        .delete(projectAiRefreshes)
        .where(
          and(
            eq(projectAiRefreshes.projectId, projectId),
            eq(projectAiRefreshes.kind, kind),
            inArray(projectAiRefreshes.outcome, ["failed", "superseded"]),
            lt(projectAiRefreshes.attemptedAt, startedAt)
          )
        );
      return;
    }
    const outcome = recordableOutcome(writerOutcome);
    if (!outcome) {
      return;
    }
    const attemptedAt = new Date();
    await db
      .insert(projectAiRefreshes)
      .values({ projectId, kind, trigger, outcome, attemptedAt })
      .onConflictDoUpdate({
        target: [projectAiRefreshes.projectId, projectAiRefreshes.kind],
        set: { trigger, outcome, attemptedAt },
        setWhere: lte(
          projectAiRefreshes.attemptedAt,
          sql`excluded.attempted_at`
        ),
      });
  } catch (error) {
    // A deleted project fails the foreign key here, which is the same
    // nothing-to-show as a missing row.
    console.error(
      `Recording the ${kind} attempt failed for project ${projectId}`,
      redactQueryError(error)
    );
  }
}

export async function readAiRefresh(
  projectId: string,
  kind: AiRefreshKind
): Promise<AiRefreshAttempt | null> {
  const [row] = await db
    .select()
    .from(projectAiRefreshes)
    .where(
      and(
        eq(projectAiRefreshes.projectId, projectId),
        eq(projectAiRefreshes.kind, kind)
      )
    );
  return row
    ? { at: row.attemptedAt, outcome: row.outcome, trigger: row.trigger }
    : null;
}

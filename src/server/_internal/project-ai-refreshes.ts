import { and, eq } from "drizzle-orm";
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
 * `skipped`, `unchanged` and `manual` make no attempt to write, and recording
 * them would add a row on every draft save and make "no row" mean nothing.
 * So a project with no row was never attempted, which is what staff need to
 * tell apart from "failed".
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
  writerOutcome: string
): Promise<void> {
  const outcome = recordableOutcome(writerOutcome);
  if (!outcome) {
    return;
  }
  try {
    const attemptedAt = new Date();
    await db
      .insert(projectAiRefreshes)
      .values({ projectId, kind, trigger, outcome, attemptedAt })
      .onConflictDoUpdate({
        target: [projectAiRefreshes.projectId, projectAiRefreshes.kind],
        set: { trigger, outcome, attemptedAt },
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

// Shared, dependency-free definitions for the record of a project's last AI
// refresh attempt (#631). Client-safe: the staff panel renders these, the
// schema types its columns with them. No AWS, no DB, no node built-ins here.

/** Which of a project's AI outputs an attempt wrote. */
export type AiRefreshKind = "embedding" | "social_summary";

/**
 * `automatic` is the background refresh after a commit, and the workstation
 * backfill scripts, which call the same writers. `staff` is a button in the
 * Social preview section.
 */
export type AiRefreshTrigger = "automatic" | "staff";

/**
 * Only the outcomes of an attempt to write. A writer's `skipped`, `unchanged`
 * and `manual` are not attempts and are never recorded, so a project with no
 * row has no attempt on record (`recordAiRefresh` says why that is not quite
 * "never attempted").
 */
export type AiRefreshOutcome = "updated" | "superseded" | "failed";

export interface AiRefreshAttempt {
  at: Date;
  outcome: AiRefreshOutcome;
  trigger: AiRefreshTrigger;
}

/**
 * The attempt to show beside an output written at `storedAt`, or null when
 * the output has been written since and the attempt is history.
 *
 * Every recorded success is stamped after its own write, so on the app's
 * paths the attempt is never older than what it stored. What makes it older
 * is a write that records nothing: a staff Save of the summary, and the
 * production `.mjs` sweeps, which re-spell the writers in SQL. Without this, a
 * failure from last week would sit beside a summary the sweep wrote today.
 */
export function currentAttempt(
  attempt: AiRefreshAttempt | null,
  storedAt: Date | null
): AiRefreshAttempt | null {
  if (!attempt) {
    return null;
  }
  return storedAt && attempt.at < storedAt ? null : attempt;
}

/**
 * What the staff panel's Similarity section renders: whether the project's
 * embedding is stored (never the vector itself), when it was written, the
 * last attempt since, and whether the automatic refresh writes for this
 * project at all. Similarity is what places a project under Similar projects
 * and in the Recommended for you sort.
 *
 * `computed` and `computedAt` are separate so a vector with no timestamp
 * still reads as computed: the button and the "missing" copy key on the
 * vector, the time is only shown.
 */
export interface SimilarityView {
  attempt: AiRefreshAttempt | null;
  computed: boolean;
  computedAt: Date | null;
  refreshable: boolean;
}

/**
 * What Recompute did, beside the view re-read after it. The writer's own
 * outcome, so `skipped` (the project left a published or archived status)
 * and `unchanged` (it was computed since the panel loaded) reach the panel
 * too.
 */
export interface RecomputeSimilarityResult extends SimilarityView {
  outcome: AiRefreshOutcome | "skipped" | "unchanged";
}

/** Narrows a writer's outcome to the ones `project_ai_refreshes` records. */
export function recordableOutcome(outcome: string): AiRefreshOutcome | null {
  return outcome === "updated" ||
    outcome === "superseded" ||
    outcome === "failed"
    ? outcome
    : null;
}

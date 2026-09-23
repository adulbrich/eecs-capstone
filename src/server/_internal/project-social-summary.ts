import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import { socialSummariesEnabled } from "#/lib/_internal/social-summary-flag";
import {
  buildSocialSummarySource,
  type SocialSummarySourceProject,
  socialSummaryHash,
} from "#/lib/social-summary-source";
import { isEmbeddableStatus, rowStillReads } from "./project-embeddings";
import {
  buildSocialSummaryConfig,
  runSocialSummary,
} from "./social-summary-core";

const MODEL_ID = buildSocialSummaryConfig().modelId;

export type SocialSummaryOutcome =
  | "skipped"
  | "manual"
  | "unchanged"
  | "updated"
  | "superseded"
  | "failed";

/**
 * Every field `buildSocialSummarySource` reads, plus the summary itself, so a
 * Regenerate that lands during the model call wins over the background
 * refresh. Regenerate guards its own write on the same columns, so of the two
 * the one that read the current text is the one that lands. A `Record` so a
 * new source field fails to compile until it is guarded here.
 */
const SUMMARY_TEXT: Record<keyof SocialSummarySourceProject, true> = {
  title: true,
  description: true,
  problemStatement: true,
};
export const SUMMARY_GUARD_COLUMNS = [
  ...(Object.keys(SUMMARY_TEXT) as (keyof SocialSummarySourceProject)[]),
  "socialSummary",
] as const;

/**
 * The single writer of a project's social summary.
 *
 * Deliberately the same shape as `refreshProjectEmbedding`, including the
 * status gate and the source hash, with one gate that has no counterpart
 * there: a summary staff wrote by hand is never overwritten. A content hash
 * can tell that the source text changed; it cannot tell that a human
 * deliberately wrote what is stored. Nothing human ever writes to
 * `projects.embedding`, which is why that column needs no equivalent.
 *
 * Gates on `isEmbeddableStatus` rather than a set of its own. The two rules
 * happen to name the same statuses today and are free to diverge, but a draft
 * has no public page to unfurl, so generating for one would spend a model call
 * on a project that may never publish.
 *
 * Never throws. Callers run it after their transaction has committed, so a
 * Bedrock outage leaves the column null or stale and the user's action still
 * succeeds. `socialDescription` in `src/lib/social-meta.ts` falls back to the
 * project's own prose, so a null column is a slightly worse preview rather
 * than a missing one.
 *
 * One property this leans on rather than enforces: the summary is written from
 * the text read at the top, so an edit landing during the model call leaves a
 * summary describing text that has already changed, paired with that older
 * text's hash. It cannot land: the write below holds only while the row still
 * reads what this read, so once the text has moved it writes nothing and
 * reports "superseded" (ADR-0053), and the edit that moved it runs this
 * function again on its own commit, reads the new text and generates from it.
 * The retry holds because `projects.ts` starts this after every commit that
 * leaves the project in an embeddable status, which is every commit that could
 * strand a pairing: the gate below skips the other statuses and a deleted row,
 * so a draft has no stored summary to go stale and gets one when it publishes,
 * and a restore starts one for whatever changed while the row was deleted. A
 * caller that writes project prose WITHOUT calling this afterwards would strand
 * the stale pairing, since nothing else recomputes the hash.
 */
export async function refreshSocialSummary(
  projectId: string,
  invoke?: ResponsesFn
): Promise<SocialSummaryOutcome> {
  try {
    if (!socialSummariesEnabled()) {
      return "skipped";
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project || project.deletedAt || !isEmbeddableStatus(project.status)) {
      return "skipped";
    }
    // Before the hash, not after: the whole point of the flag is that a change
    // to the source text must not reach a summary a human wrote.
    if (project.socialSummaryIsManual) {
      return "manual";
    }

    const source = buildSocialSummarySource(project);
    if (!source) {
      // A project with no title, description or problem statement at all.
      // Nothing to summarise, and the fallback chain covers the page.
      return "skipped";
    }
    const hash = socialSummaryHash(source, MODEL_ID);
    // The second half matters for the same reason it does on the embedding: a
    // row carrying a current hash and a null summary is an interrupted write,
    // and without it every later sweep reads the hash as current and moves on.
    if (project.socialSummarySourceHash === hash && project.socialSummary) {
      return "unchanged";
    }

    const run = await runSocialSummary(source, invoke);
    if (!run.result) {
      // Logged rather than surfaced: the save or publish already succeeded,
      // and the caller has nothing useful to do with this.
      console.error(
        `Social summary failed for project ${projectId}: ${run.error}`
      );
      return "failed";
    }
    // The guard is on the write, not only on the read above, and it is the
    // read that is insufficient rather than redundant. The manual flag is read
    // before `runSocialSummary` and the row is written after it, so a staff
    // save landing in that window would otherwise be overwritten by text the
    // model had already begun producing, while the flag they set stayed true
    // and skipped the row out of every later refresh. Losing the race must
    // mean writing nothing, so the condition belongs in the statement that
    // does the writing.
    const written = await db
      .update(projects)
      .set({
        socialSummary: run.result,
        socialSummarySourceHash: hash,
        socialSummaryUpdatedAt: new Date(),
      })
      .where(
        and(
          rowStillReads(project, SUMMARY_GUARD_COLUMNS),
          eq(projects.socialSummaryIsManual, false)
        )
      )
      .returning({ id: projects.id });
    return written.length > 0 ? "updated" : "superseded";
  } catch (error) {
    console.error(
      `Social summary failed for project ${projectId}`,
      redactQueryError(error)
    );
    return "failed";
  }
}

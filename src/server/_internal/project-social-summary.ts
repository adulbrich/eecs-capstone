import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { socialSummariesEnabled } from "#/lib/_internal/social-summary-flag";
import {
  buildSocialSummarySource,
  socialSummaryHash,
} from "#/lib/social-summary-source";
import { isEmbeddableStatus } from "./project-embeddings";
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
  | "failed";

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
          eq(projects.id, projectId),
          eq(projects.socialSummaryIsManual, false)
        )
      )
      .returning({ id: projects.id });
    return written.length > 0 ? "updated" : "manual";
  } catch (error) {
    console.error(`Social summary failed for project ${projectId}`, error);
    return "failed";
  }
}

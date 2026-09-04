import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type {
  ImprovableField,
  ReviewResult,
} from "#/lib/project-review-fields";
import { canEditProject } from "#/lib/project-visibility";
import { assertWithinLimit, recordReviewUsage } from "./ai-review-usage";
import { runProjectReview } from "./project-review-core";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

export interface ReviewProjectInput {
  fields: Partial<Record<ImprovableField, string>>;
  /**
   * Absent on the submission page, where the proposal has not been saved yet.
   * See the authorization note on `reviewProjectAs`.
   */
  projectId?: string | undefined;
}

/**
 * Two authorization paths, because there are two things a review can be about.
 *
 * With a project, the question is whether this viewer may edit that project,
 * unchanged from before. Without one, the text is unsaved and belongs to
 * nobody else, so ownership is the wrong question and a verified session is
 * the whole gate.
 *
 * Ownership was also the only thing bounding spend, since you had to own a
 * project to reach a paid endpoint. The limiter below replaces it, and is not
 * optional for that reason.
 */
export async function reviewProjectAs(
  viewer: AuthUser,
  input: ReviewProjectInput
): Promise<ReviewResult> {
  if (input.projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId));
    if (!project) {
      throw new Error("Project not found");
    }
    if (!canEditProject(project, viewer)) {
      throw new Error("Forbidden");
    }
  }

  await assertWithinLimit(viewer.id, "review");

  const run = await runProjectReview(input.fields);
  // Metered on whether a paid call happened, not on whether it succeeded. A
  // truncated response is billed in full, so counting only successes would let
  // a user spend without limit by repeating a call that fails.
  if (run.called) {
    await recordReviewUsage({
      feature: "review",
      userId: viewer.id,
      projectId: input.projectId,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      inputTokens: run.usage?.inputTokens,
      outputTokens: run.usage?.outputTokens,
      reasoningTokens: run.usage?.reasoningTokens,
      reviewedFieldCount: run.result.reviewedFields.length,
      outcome: run.outcome,
    });
  }
  if (run.error) {
    throw new Error(run.error);
  }
  return run.result;
}

export async function reviewProjectForCurrentUser(
  input: ReviewProjectInput
): Promise<ReviewResult> {
  const viewer = await requireUser();
  return reviewProjectAs(viewer, input);
}

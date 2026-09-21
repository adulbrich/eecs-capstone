import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import {
  mantleResponses,
  type ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import {
  SOCIAL_SUMMARY_MAX_LENGTH,
  type SocialSummaryView,
} from "#/lib/social-summary";
import {
  buildSocialSummarySource,
  socialSummaryHash,
} from "#/lib/social-summary-source";
import { assertStaff } from "#/lib/viewer";
import type {
  SaveSocialSummaryInput,
  SocialSummaryInput,
} from "../social-summary";
import { assertWithinLimit, recordReviewUsage } from "./ai-review-usage";
import {
  buildSocialSummaryConfig,
  runSocialSummary,
} from "./social-summary-core";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

const MODEL_ID = buildSocialSummaryConfig().modelId;

async function loadProject(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

function toView(project: typeof projects.$inferSelect): SocialSummaryView {
  return {
    summary: project.socialSummary,
    updatedAt: project.socialSummaryUpdatedAt,
    isManual: project.socialSummaryIsManual,
  };
}

export async function getSocialSummaryAs(
  viewer: AuthUser,
  data: SocialSummaryInput
): Promise<SocialSummaryView> {
  assertStaff(viewer);
  return toView(await loadProject(data.projectId));
}

export async function getSocialSummaryForCurrentUser(
  data: SocialSummaryInput
): Promise<SocialSummaryView> {
  const viewer = await requireUser();
  return getSocialSummaryAs(viewer, data);
}

/**
 * Staff write their own wording.
 *
 * Sets `socialSummaryIsManual`, which is what stops the automatic refresh on
 * the next publish or prose edit from overwriting it. The hash is left alone
 * on purpose: it records what the model last saw, and a manual row is not
 * reading it any more.
 *
 * Staff only, and the seam is where that is enforced. The panel is hidden from
 * everyone else, and a hidden panel is not a gate.
 */
export async function saveSocialSummaryAs(
  viewer: AuthUser,
  data: SaveSocialSummaryInput
): Promise<SocialSummaryView> {
  assertStaff(viewer);
  const project = await loadProject(data.projectId);
  const summary = data.summary.trim();
  if (!summary) {
    // Clearing is what Regenerate is for. Allowing an empty save would make a
    // blank summary reachable deliberately rather than only through an outage.
    throw new Error("A summary cannot be empty. Use Regenerate with AI.");
  }
  if (summary.length > SOCIAL_SUMMARY_MAX_LENGTH) {
    throw new Error(
      `A summary is at most ${SOCIAL_SUMMARY_MAX_LENGTH} characters.`
    );
  }
  const updatedAt = new Date();
  await db
    .update(projects)
    .set({
      socialSummary: summary,
      socialSummaryIsManual: true,
      socialSummaryUpdatedAt: updatedAt,
    })
    .where(eq(projects.id, project.id));
  return { summary, updatedAt, isManual: true };
}

export async function saveSocialSummaryForCurrentUser(
  data: SaveSocialSummaryInput
): Promise<SocialSummaryView> {
  const viewer = await requireUser();
  return saveSocialSummaryAs(viewer, data);
}

/**
 * Staff hand the field back to the model.
 *
 * The only user-triggered model call in this feature, so the only one that
 * meters against a limit. Unlike the automatic path in
 * `project-social-summary.ts`, a failure here is thrown rather than swallowed:
 * someone pressed a button and is waiting for an answer, which is the same
 * split `refreshInterestsEmbedding` draws against the project embedding.
 *
 * Clears `socialSummaryIsManual` and writes a fresh hash, so the project
 * rejoins the automatic path from here on.
 */
export async function regenerateSocialSummaryAs(
  viewer: AuthUser,
  data: SocialSummaryInput,
  invoke: ResponsesFn = mantleResponses
): Promise<SocialSummaryView> {
  assertStaff(viewer);
  const project = await loadProject(data.projectId);
  const source = buildSocialSummarySource(project);
  if (!source) {
    throw new Error(
      "This project has no title, description or problem statement to summarise."
    );
  }
  await assertWithinLimit(viewer.id, "social-summary");

  const run = await runSocialSummary(source, invoke);
  // Metered on whether a paid call happened, as the review and the scope
  // assessment are: a failed or truncated attempt is billed all the same.
  if (run.called) {
    await recordReviewUsage({
      feature: "social-summary",
      userId: viewer.id,
      projectId: project.id,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      inputTokens: run.usage?.inputTokens,
      outputTokens: run.usage?.outputTokens,
      reasoningTokens: run.usage?.reasoningTokens,
      outcome: run.outcome,
    });
  }
  if (!run.result) {
    // Thrown, not swallowed, and the stored summary is left untouched: staff
    // keep whatever was there rather than losing it to a failed attempt.
    throw new Error(run.error ?? "Social summary failed");
  }
  const updatedAt = new Date();
  await db
    .update(projects)
    .set({
      socialSummary: run.result,
      socialSummarySourceHash: socialSummaryHash(source, MODEL_ID),
      socialSummaryIsManual: false,
      socialSummaryUpdatedAt: updatedAt,
    })
    .where(eq(projects.id, project.id));
  return { summary: run.result, updatedAt, isManual: false };
}

export async function regenerateSocialSummaryForCurrentUser(
  data: SocialSummaryInput
): Promise<SocialSummaryView> {
  const viewer = await requireUser();
  return regenerateSocialSummaryAs(viewer, data);
}

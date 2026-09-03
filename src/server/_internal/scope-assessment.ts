import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { programs, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import {
  mantleResponses,
  type ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import {
  type ScopeAssessmentView,
  scopeAssessmentSchema,
} from "#/lib/scope-assessment";
import {
  buildScopeSource,
  type ScopeSourceProgram,
  scopeSourceHash,
} from "#/lib/scope-assessment-source";
import { assertStaff } from "#/lib/viewer";
import type { ScopeAssessmentInput } from "../scope-assessment";
import { assertWithinLimit, recordReviewUsage } from "./ai-review-usage";
import { buildScopeConfig, runScopeAssessment } from "./scope-assessment-core";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

const MODEL_ID = buildScopeConfig().modelId;

/** What the jsonb column is trusted to hold; anything else reads as absent. */
const storedSchema = scopeAssessmentSchema.extend({ model: z.string() });

async function loadScopeInput(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  let program: ScopeSourceProgram = { label: null, termCount: null };
  if (project.programId) {
    const [row] = await db
      .select({
        courseId: programs.courseId,
        courseName: programs.courseName,
        termCount: programs.termCount,
      })
      .from(programs)
      .where(eq(programs.id, project.programId));
    if (row) {
      program = {
        label: `${row.courseId} ${row.courseName}`,
        termCount: row.termCount,
      };
    }
  }
  const source = buildScopeSource(project, program);
  return { project, source, hash: scopeSourceHash(source, MODEL_ID) };
}

/**
 * The staleness rule, reused from the embedding columns: the stored hash is
 * compared with the hash of the project's current text, and a mismatch is
 * reported rather than acted on. Re-running silently would spend money on
 * every page view; hiding the verdict would throw away what staff were about
 * to read.
 */
function toView(
  project: typeof projects.$inferSelect,
  currentHash: string
): ScopeAssessmentView | null {
  const stored = storedSchema.safeParse(project.scopeAssessment);
  if (!(stored.success && project.scopeAssessmentUpdatedAt)) {
    if (project.scopeAssessment !== null) {
      // A stored verdict the current schema no longer accepts (an enum or
      // cap changed under it). Nothing renders, so say so where an operator
      // looks, rather than throwing away a verdict silently.
      console.error(
        `Stored scope assessment for project ${project.id} does not parse; reassess it`
      );
    }
    return null;
  }
  return {
    assessment: stored.data,
    assessedAt: project.scopeAssessmentUpdatedAt,
    stale: project.scopeAssessmentSourceHash !== currentHash,
  };
}

export async function getScopeAssessmentAs(
  viewer: AuthUser,
  data: ScopeAssessmentInput
): Promise<ScopeAssessmentView | null> {
  assertStaff(viewer);
  const { project, hash } = await loadScopeInput(data.projectId);
  return toView(project, hash);
}

export async function getScopeAssessmentForCurrentUser(
  data: ScopeAssessmentInput
): Promise<ScopeAssessmentView | null> {
  const viewer = await requireUser();
  return getScopeAssessmentAs(viewer, data);
}

/**
 * Only staff, and the seam is where that is enforced: the button in the panel
 * is hidden from everyone else, and a hidden button is not a gate. The limit
 * check runs before the paid call and under the scope feature's own pair.
 */
export async function assessProjectScopeAs(
  viewer: AuthUser,
  data: ScopeAssessmentInput,
  invoke: ResponsesFn = mantleResponses
): Promise<ScopeAssessmentView> {
  assertStaff(viewer);
  const { project, source, hash } = await loadScopeInput(data.projectId);
  await assertWithinLimit(viewer.id, "scope");

  const run = await runScopeAssessment(source, invoke);
  // Metered on whether a paid call happened, as the review is: a failed or
  // truncated attempt is billed all the same.
  if (run.called) {
    await recordReviewUsage({
      feature: "scope",
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
    throw new Error(run.error ?? "Scope assessment failed");
  }
  const assessedAt = new Date();
  await db
    .update(projects)
    .set({
      scopeAssessment: run.result,
      scopeAssessmentSourceHash: hash,
      scopeAssessmentUpdatedAt: assessedAt,
    })
    .where(eq(projects.id, project.id));
  return { assessment: run.result, assessedAt, stale: false };
}

export async function assessProjectScopeForCurrentUser(
  data: ScopeAssessmentInput
): Promise<ScopeAssessmentView> {
  const viewer = await requireUser();
  return assessProjectScopeAs(viewer, data);
}

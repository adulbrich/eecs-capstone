import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import {
  currentAttempt,
  type RecomputeSimilarityResult,
  type SimilarityView,
} from "#/lib/ai-refresh";
import { assertStaff } from "#/lib/viewer";
import type { SimilarityInput } from "../similarity";
import { readAiRefresh } from "./project-ai-refreshes";
import { isRefreshable, refreshProjectEmbedding } from "./project-embeddings";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

/**
 * The project's embedding status for the staff panel (#631), without the
 * vector. Read with its own query rather than `select()`, so the 1024 floats
 * never leave the database for a yes or no.
 */
async function loadView(projectId: string): Promise<SimilarityView> {
  const [project] = await db
    .select({
      computed: projects.embedding,
      computedAt: projects.embeddingUpdatedAt,
      deletedAt: projects.deletedAt,
      status: projects.status,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  const computedAt = project.computed ? project.computedAt : null;
  return {
    attempt: currentAttempt(
      await readAiRefresh(projectId, "embedding"),
      computedAt
    ),
    computedAt,
    refreshable: isRefreshable(project),
  };
}

export async function getSimilarityAs(
  viewer: AuthUser,
  data: SimilarityInput
): Promise<SimilarityView> {
  assertStaff(viewer);
  return await loadView(data.projectId);
}

export async function getSimilarityForCurrentUser(
  data: SimilarityInput
): Promise<SimilarityView> {
  const viewer = await requireUser();
  return getSimilarityAs(viewer, data);
}

/**
 * Staff recompute a project's similarity after the automatic attempt failed
 * (#631).
 *
 * The same writer the background refresh runs, awaited, with `trigger:
 * staff`, so it records its own attempt and every gate still applies: a
 * draft or deleted project returns `skipped` and a current vector
 * `unchanged`, neither calling Bedrock. The panel offers the button only
 * after a failure or with nothing computed, so those two reach here only
 * through a change that landed since the panel loaded.
 *
 * Not metered, unlike Regenerate. A Titan embedding costs a fraction of a
 * cent, the button is staff-only, and the interests embedding is unmetered
 * for the same reason. Making it an `AiFeature` would also list it on every
 * user's page beside the paid calls.
 *
 * Returns the writer's outcome rather than throwing on `failed`, because the
 * view re-read beside it already shows the failure and its time.
 */
export async function recomputeSimilarityAs(
  viewer: AuthUser,
  data: SimilarityInput,
  embed?: EmbedFn
): Promise<RecomputeSimilarityResult> {
  assertStaff(viewer);
  const outcome = await refreshProjectEmbedding(data.projectId, embed, "staff");
  return { ...(await loadView(data.projectId)), outcome };
}

export async function recomputeSimilarityForCurrentUser(
  data: SimilarityInput
): Promise<RecomputeSimilarityResult> {
  const viewer = await requireUser();
  return recomputeSimilarityAs(viewer, data);
}

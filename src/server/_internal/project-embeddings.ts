import { eq } from "drizzle-orm";
import { db } from "#/db";
import {
  categories,
  programs,
  projectCategories,
  projects,
  userInterests,
} from "#/db/schema";
import {
  bedrockEmbed,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  type EmbedFn,
} from "#/lib/_internal/bedrock-embed";
import {
  buildInterestsEmbeddingSource,
  buildProjectEmbeddingSource,
  embeddingHash,
} from "#/lib/embedding-source";

export type RefreshOutcome = "skipped" | "unchanged" | "updated" | "failed";

/** pgvector's text input format, e.g. `[0.1,0.2]`. */
export function toSqlVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * The single writer of a project's embedding.
 *
 * Never throws. Callers run it after their transaction has committed, so a
 * Bedrock outage leaves the vector null or stale and the user's action still
 * succeeds. `scripts/backfill-embeddings.ts` sweeps up whatever this leaves
 * behind.
 */
export async function refreshProjectEmbedding(
  projectId: string,
  embed: EmbedFn = bedrockEmbed
): Promise<RefreshOutcome> {
  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project || project.status !== "published" || project.deletedAt) {
      return "skipped";
    }

    const categoryRows = await db
      .select({ name: categories.name })
      .from(projectCategories)
      .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
      .where(eq(projectCategories.projectId, projectId));

    let programLabel: string | null = null;
    if (project.programId) {
      const [program] = await db
        .select({
          courseId: programs.courseId,
          courseName: programs.courseName,
        })
        .from(programs)
        .where(eq(programs.id, project.programId));
      programLabel = program
        ? `${program.courseId} ${program.courseName}`
        : null;
    }

    const source = buildProjectEmbeddingSource(
      project,
      categoryRows.map((row) => row.name),
      programLabel
    );
    const hash = embeddingHash(
      source,
      EMBEDDING_MODEL_ID,
      EMBEDDING_DIMENSIONS
    );
    if (project.embeddingSourceHash === hash) {
      return "unchanged";
    }

    const vector = await embed(source);
    await db
      .update(projects)
      .set({
        embedding: vector,
        embeddingSourceHash: hash,
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
    return "updated";
  } catch (error) {
    // Never surfaced to the caller: the publish or save already succeeded.
    console.error(`Embedding failed for project ${projectId}`, error);
    return "failed";
  }
}

/**
 * The single writer of a user's interest embedding. Unlike the project path,
 * the outcome is returned to the UI, because the user explicitly asked for
 * their recommendations to be prepared.
 *
 * Never throws. Callers run it after their transaction has committed, so a
 * Bedrock outage leaves the vector null or stale and the user's action still
 * succeeds. `scripts/backfill-embeddings.ts` sweeps up whatever this leaves
 * behind.
 */
export async function refreshInterestsEmbedding(
  userId: string,
  embed: EmbedFn = bedrockEmbed
): Promise<RefreshOutcome> {
  try {
    const [row] = await db
      .select()
      .from(userInterests)
      .where(eq(userInterests.userId, userId));
    if (!row) {
      return "skipped";
    }

    const source = buildInterestsEmbeddingSource(row.interestsText);
    if (!source) {
      return "skipped";
    }
    const hash = embeddingHash(
      source,
      EMBEDDING_MODEL_ID,
      EMBEDDING_DIMENSIONS
    );
    if (row.embeddingSourceHash === hash && row.embedding) {
      return "unchanged";
    }

    const vector = await embed(source);
    await db
      .update(userInterests)
      .set({
        embedding: vector,
        embeddingSourceHash: hash,
        embeddingUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userInterests.userId, userId));
    return "updated";
  } catch (error) {
    console.error(`Embedding failed for user interests ${userId}`, error);
    return "failed";
  }
}

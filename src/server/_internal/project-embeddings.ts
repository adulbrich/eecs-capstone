/**
 * READ AS TEXT by `src/test/backfill-embeddings-parity.test.ts`, which pins
 * the parts `scripts/backfill-embeddings.mjs` has to copy because it cannot
 * import across the production image boundary (ADR-0024). That puts two
 * constraints on this file that no editor would otherwise guess, so they are
 * written here rather than only in the test:
 *
 * - No URL anywhere, in a string or a comment. The test strips comments by
 *   regex before matching, and the two slashes in a scheme, inside a string
 *   literal, would make the strip eat real code. It refuses the sequence
 *   rather than trying to tell a comment from a string, which is the job of
 *   the strip it protects. Cite a doc by path or by ADR number, not by link.
 *   You cannot even write the sequence here to explain it, as this comment
 *   found out.
 * - Keep at least one `//` comment at the start of a line, and the
 *   `export async function refreshProjectEmbedding(` signature intact. The
 *   test proves the strip actually removed something and kept something, and
 *   those are what it looks for.
 *
 * The statement the pin compares is the skip inside `refreshProjectEmbedding`.
 * Change it and the script has to change with it, in the same commit.
 */
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { db } from "#/db";
import { projects, userInterests } from "#/db/schema";
import {
  bedrockEmbed,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  type EmbedFn,
} from "#/lib/_internal/bedrock-embed";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  buildInterestsEmbeddingSource,
  buildProjectEmbeddingSource,
  type EmbeddableProject,
  embeddingHash,
} from "#/lib/embedding-source";
import type { SocialSummarySourceProject } from "#/lib/social-summary-source";
import type { ProjectStatus } from "#/lib/vocabularies";

export type RefreshOutcome =
  | "skipped"
  | "unchanged"
  | "updated"
  | "superseded"
  | "cleared"
  | "failed";

type GuardedColumn =
  | keyof EmbeddableProject
  | keyof SocialSummarySourceProject
  | "socialSummary";

/**
 * A WHERE clause that holds only while the row still reads what a refresh
 * read. The refresh runs after the save has answered (ADR-0053), so a second
 * edit can commit on another task during the model call, and without this the
 * slower refresh would pair the newer text with a vector or summary of the
 * older one. The late write matches nothing instead, and the edit that won
 * has started a refresh of its own.
 */
export function rowStillReads(
  project: typeof projects.$inferSelect,
  columns: readonly GuardedColumn[]
): SQL | undefined {
  return and(
    eq(projects.id, project.id),
    ...columns.map((column) => {
      const value = project[column];
      return value === null
        ? isNull(projects[column])
        : eq(projects[column], value);
    })
  );
}

/**
 * Every field `buildProjectEmbeddingSource` reads. A `Record` rather than a
 * list, so a field added to `EmbeddableProject` fails to compile here until
 * the write guards it too.
 */
const EMBEDDED_TEXT: Record<keyof EmbeddableProject, true> = {
  title: true,
  description: true,
  problemStatement: true,
  objectives: true,
  minQualifications: true,
  prefQualifications: true,
  licenseRestrictions: true,
};
const EMBEDDED_TEXT_COLUMNS = Object.keys(
  EMBEDDED_TEXT
) as (keyof EmbeddableProject)[];

/**
 * The statuses that carry an embedding. `refreshProjectEmbedding` gates on it,
 * both callers in `projects.ts` ask it rather than repeating the comparison,
 * and `scripts/backfill-embeddings.ts` selects on it.
 *
 * `archived` is in because the 547 projects imported from the legacy portal
 * land there directly and would otherwise never get a vector (#427). An
 * in-app project reaches `archived` only from `published`
 * (`src/lib/project-workflow.ts`), so archiving keeps the vector it had; this
 * is what lets an archived project be re-embedded when someone edits it.
 *
 * `canSeeProject` in `src/lib/project-visibility.ts` names the same two
 * statuses today and is a different rule (who may read a project, not what
 * carries a vector). They are free to diverge; do not merge them.
 *
 * Two things this does not reach. `scripts/backfill-embeddings.mjs` spells the
 * set again in SQL, because the production image ships no `src/`, and
 * `src/test/backfill-embeddings-parity.test.ts` pins that copy against this
 * one. And adding a status here embeds nothing that is already in it: run
 * either sweeper for that.
 */
export const EMBEDDABLE_STATUSES: readonly ProjectStatus[] = [
  "published",
  "archived",
];

export function isEmbeddableStatus(status: ProjectStatus): boolean {
  return EMBEDDABLE_STATUSES.includes(status);
}

/** pgvector's text input format, e.g. `[0.1,0.2]`. */
export function toSqlVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/**
 * The single writer of a project's embedding.
 *
 * Writes for the statuses `isEmbeddableStatus` names and skips every other
 * one, including a soft-deleted row.
 *
 * Never throws. Callers run it after their transaction has committed, so a
 * Bedrock outage leaves the vector null or stale and the user's action still
 * succeeds. `scripts/backfill-embeddings.ts` sweeps up whatever this leaves
 * behind on a workstation, `scripts/backfill-embeddings.mjs` in production.
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
    if (!project || project.deletedAt || !isEmbeddableStatus(project.status)) {
      return "skipped";
    }

    // The row and nothing else: the embedded text is the project's own prose,
    // so neither its categories nor its program is read here any more
    // (ADR-0025). Editing either leaves the hash alone and this returns
    // "unchanged", which is correct rather than a miss.
    const source = buildProjectEmbeddingSource(project);
    const hash = embeddingHash(
      source,
      EMBEDDING_MODEL_ID,
      EMBEDDING_DIMENSIONS
    );
    // `&& project.embedding`, the way `refreshInterestsEmbedding` below does
    // it. A row carrying a current hash and a null vector is an interrupted
    // write, and without the second half it would be unreachable forever:
    // every sweeper reads the hash as current and moves on. Both
    // `scripts/backfill-embeddings.ts` and `scripts/backfill-embeddings.mjs`
    // apply this same pair, so all three agree about who owns that row.
    if (project.embeddingSourceHash === hash && project.embedding) {
      return "unchanged";
    }

    const vector = await embed(source);
    const written = await db
      .update(projects)
      .set({
        embedding: vector,
        embeddingSourceHash: hash,
        embeddingUpdatedAt: new Date(),
      })
      .where(rowStillReads(project, EMBEDDED_TEXT_COLUMNS))
      .returning({ id: projects.id });
    return written.length > 0 ? "updated" : "superseded";
  } catch (error) {
    // Never surfaced to the caller: the publish or save already succeeded.
    console.error(
      `Embedding failed for project ${projectId}`,
      redactQueryError(error)
    );
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
      if (row.embedding || row.embeddingSourceHash) {
        await db
          .update(userInterests)
          .set({
            embedding: null,
            embeddingSourceHash: null,
            embeddingUpdatedAt: new Date(),
          })
          .where(eq(userInterests.userId, userId));
        return "cleared";
      }
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
    // The `ai_write_failures` metric filter in `infra/alarms.tf` counts this
    // line by its exact wording, since no refresh line reports this writer.
    console.error(
      `Embedding failed for user interests ${userId}`,
      redactQueryError(error)
    );
    return "failed";
  }
}

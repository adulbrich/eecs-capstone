// The categorizer's automatic writer (#31): the run on submit and each step of
// the backfill. Nothing here reads a session, so the background queue in
// `project-refresh.ts` can import it without pulling Better Auth into every
// module that starts a refresh; the staff paths are in
// `regenerate-categories.ts`, as the social summary's are split.
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import { categories, projectCategories, projects } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { categoriesEnabled } from "#/lib/_internal/categories-flag";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import {
  buildCategorizeSource,
  buildCategorizeTool,
  type CategoryOption,
} from "#/lib/categorize";
import { KIND_OF_WORK_TYPE } from "#/lib/default-categories";
import { type CategorizeRun, runCategorize } from "./categorize-core";
import { readAiRefresh, recordAiRefresh } from "./project-ai-refreshes";
import { lockProjectCategories } from "./project-category-lock";

/**
 * The live project categories with how many published projects carry each,
 * read on every run since staff edit the list (#31). Published only, because
 * "established in the catalog students browse" is what the count stands for;
 * an abandoned draft must not outweigh real use. One GROUP BY over the
 * junction, left-joined so an unused category counts zero.
 */
export async function loadCategoryOptions(): Promise<CategoryOption[]> {
  const published = db
    .select({
      categoryId: projectCategories.categoryId,
      usage: sql<number>`count(*)::int`.as("usage"),
    })
    .from(projectCategories)
    .innerJoin(
      projects,
      and(
        eq(projects.id, projectCategories.projectId),
        eq(projects.status, "published"),
        isNull(projects.deletedAt)
      )
    )
    .groupBy(projectCategories.categoryId)
    .as("published");
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
      description: categories.description,
      usage: sql<number>`coalesce(${published.usage}, 0)::int`,
    })
    .from(categories)
    .leftJoin(published, eq(published.categoryId, categories.id))
    .where(and(eq(categories.domain, "project"), isNotNull(categories.type)));
  return rows.map((row) => ({ ...row, type: row.type ?? "" }));
}

export async function projectCategoryIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: projectCategories.categoryId })
    .from(projectCategories)
    .where(eq(projectCategories.projectId, projectId));
  return rows.map((r) => r.id).sort();
}

/**
 * One line per paid call, for cost tracking: the automatic run and the
 * backfill meter against no one's limit, so this is their only record of
 * spend (#31). Its own wording, not the refresh line's: the
 * `ai_write_failures` filter is anchored on that one.
 */
export function logRun(
  projectId: string,
  how: string,
  outcome: string,
  run: CategorizeRun,
  startedAt: Date
) {
  console.log(
    `Project categories for ${projectId} (${how}): ${outcome}, ${run.model}, ${run.usage?.inputTokens ?? "?"} in, ${run.usage?.outputTokens ?? "?"} out, ${Date.now() - startedAt.getTime()} ms`
  );
}

export type CategorizeOutcome = "skipped" | "updated" | "superseded" | "failed";

/** Which automatic path started a run, for the hold-off and the log line. */
export type CategorizeHow = "submit" | "backfill";

/**
 * How long a failed run on submit holds off the next one for that project.
 * A success ends the runs by itself, since the project then has categories,
 * so only failures can repeat; without this a proposer could withdraw and
 * resubmit a project the model keeps failing on, each time an unmetered paid
 * call. An hour bounds that to a handful a day and still retries an outage.
 */
export const SUBMIT_RETRY_AFTER_MS = 60 * 60 * 1000;

async function failedRecently(projectId: string): Promise<boolean> {
  const last = await readAiRefresh(projectId, "categories");
  return (
    last?.outcome === "failed" &&
    Date.now() - last.at.getTime() < SUBMIT_RETRY_AFTER_MS
  );
}

/**
 * Files a project that carries no categories, the automatic run on submit
 * and each step of the backfill (#31). Picks from the live list only: its
 * tool has no field for a new category.
 *
 * Writes only while the project still carries none. A staff save landing
 * during the model call wins, and this reports `superseded`, the way the
 * social summary's write guards on the row it read (ADR-0053).
 *
 * Never throws, for the reason the refresh writers never throw: it runs after
 * a committed transition, and a failed model call must leave the project
 * exactly as it was, submitted with no categories. Records the attempt for the
 * staff panel (ADR-0060). `skipped` covers the kill switch, a deleted or
 * missing project, one that already has categories, and a list with no Field
 * or no Kind of work to pick from; none of those is an attempt.
 */
export async function categorizeProject(
  projectId: string,
  invoke?: ResponsesFn,
  how: CategorizeHow = "submit"
): Promise<CategorizeOutcome> {
  const startedAt = new Date();
  const outcome = await writeFirstCategories(projectId, invoke, how, startedAt);
  await recordAiRefresh(
    projectId,
    "categories",
    "automatic",
    outcome,
    startedAt
  );
  return outcome;
}

async function writeFirstCategories(
  projectId: string,
  invoke: ResponsesFn | undefined,
  how: CategorizeHow,
  startedAt: Date
): Promise<CategorizeOutcome> {
  try {
    if (!categoriesEnabled()) {
      return "skipped";
    }
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project || project.deletedAt) {
      return "skipped";
    }
    if ((await projectCategoryIds(projectId)).length > 0) {
      return "skipped";
    }
    if (how === "submit" && (await failedRecently(projectId))) {
      return "skipped";
    }
    const tool = buildCategorizeTool(await loadCategoryOptions(), {
      allowProposal: false,
    });
    if (!tool) {
      console.error(
        `Project categories for ${projectId}: skipped, the list has no Field or no ${KIND_OF_WORK_TYPE} category`
      );
      return "skipped";
    }
    const run = await runCategorize(
      buildCategorizeSource(project),
      tool,
      { allowProposal: false },
      invoke
    );
    if (!run.result) {
      logRun(projectId, how, "failed", run, startedAt);
      return "failed";
    }
    const ids = run.result.categoryIds;
    // Under the lock every writer of a project's set takes, so a staff Save
    // either committed before the NOT EXISTS and wins, or waits for this.
    const written = await db.transaction(async (tx) => {
      await lockProjectCategories(tx, projectId);
      return await tx
        .insert(projectCategories)
        .select(
          tx
            .select({
              projectId: sql<string>`${projectId}::uuid`.as("project_id"),
              categoryId: categories.id,
            })
            .from(categories)
            // A category deleted during the call drops out here rather than
            // failing the foreign key.
            .where(
              and(
                inArray(categories.id, ids),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(projectCategories)
                    .where(eq(projectCategories.projectId, projectId))
                )
              )
            )
        )
        .onConflictDoNothing()
        .returning({ id: projectCategories.categoryId });
    });
    const outcome = written.length > 0 ? "updated" : "superseded";
    logRun(projectId, how, outcome, run, startedAt);
    return outcome;
  } catch (error) {
    console.error(
      `Project categories failed for ${projectId}`,
      redactQueryError(error)
    );
    return "failed";
  }
}

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
import { requireUser } from "#/lib/_internal/auth-guards";
import {
  mantleResponses,
  type ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import { categoriesEnabled } from "#/lib/_internal/categories-flag";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import type { AiRefreshAttempt } from "#/lib/ai-refresh";
import {
  buildCategorizeSource,
  buildCategorizeTool,
  type CategoryOption,
  type CategoryProposal,
} from "#/lib/categorize";
import { KIND_OF_WORK_TYPE } from "#/lib/default-categories";
import { assertStaff } from "#/lib/viewer";
import type {
  ApproveProposedCategoryInput,
  ProjectCategorizationInput,
} from "../categories";
import { assertWithinLimit, recordReviewUsage } from "./ai-review-usage";
import { createCategoryAs, listCategoryTypesImpl } from "./categories";
import { type CategorizeRun, runCategorize } from "./categorize-core";
import { readAiRefresh, recordAiRefresh } from "./project-ai-refreshes";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

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

async function projectCategoryIds(projectId: string): Promise<string[]> {
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
function logRun(
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
  how: "submit" | "backfill" = "submit"
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
  how: string,
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
    const written = await db
      .insert(projectCategories)
      .select(
        db
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
                db
                  .select({ one: sql`1` })
                  .from(projectCategories)
                  .where(eq(projectCategories.projectId, projectId))
              )
            )
          )
      )
      .onConflictDoNothing()
      .returning({ id: projectCategories.categoryId });
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

/** What the staff Categories section shows beside the picker. */
export interface ProjectCategorizationView {
  /** The last attempt on record (ADR-0060), or null. */
  attempt: AiRefreshAttempt | null;
  /** False on a soft-deleted project, matching `canEditProject`. */
  regenerable: boolean;
}

export async function getProjectCategorizationAs(
  viewer: AuthUser,
  data: ProjectCategorizationInput
): Promise<ProjectCategorizationView> {
  assertStaff(viewer);
  const [project] = await db
    .select({ id: projects.id, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  return {
    attempt: await readAiRefresh(project.id, "categories"),
    regenerable: !project.deletedAt,
  };
}

export async function getProjectCategorizationForCurrentUser(
  data: ProjectCategorizationInput
): Promise<ProjectCategorizationView> {
  const viewer = await requireUser();
  return getProjectCategorizationAs(viewer, data);
}

export interface RegenerateCategoriesResult extends ProjectCategorizationView {
  /** The project's categories after the call, whoever wrote them. */
  categoryIds: string[];
  /**
   * `superseded`: someone changed the project's categories while the model
   * worked, and nothing was replaced.
   */
  outcome: "updated" | "superseded";
  /** At most one new category, shown to staff and never stored (#31). */
  proposal: CategoryProposal | null;
}

/**
 * Staff ask for a fresh set from the current text (#31). Replaces rather than
 * merges, so the result reflects the text and not every earlier version. Any
 * status but soft-deleted. The only path that may propose a new category,
 * and the only categorizer call that meters against `ai_review_usage`.
 *
 * A compare-and-swap on the project's category set, read before the call and
 * checked under a row lock at the write: a colleague's Save during the
 * seconds of the call wins, and this says so rather than overwriting it.
 *
 * Throws on a failed call, unlike the automatic run: someone pressed a button
 * and is waiting for an answer.
 */
export async function regenerateProjectCategoriesAs(
  viewer: AuthUser,
  data: ProjectCategorizationInput,
  invoke: ResponsesFn = mantleResponses
): Promise<RegenerateCategoriesResult> {
  assertStaff(viewer);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.deletedAt) {
    throw new Error("Restore the project before regenerating its categories.");
  }
  const before = await projectCategoryIds(project.id);
  const tool = buildCategorizeTool(await loadCategoryOptions(), {
    allowProposal: true,
  });
  if (!tool) {
    throw new Error(
      `Add at least one Field and one ${KIND_OF_WORK_TYPE} category on the Categories page first.`
    );
  }
  await assertWithinLimit(viewer.id, "categories");

  const startedAt = new Date();
  const run = await runCategorize(
    buildCategorizeSource(project),
    tool,
    { allowProposal: true },
    invoke
  );
  if (run.called) {
    await recordReviewUsage({
      feature: "categories",
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
    await recordAiRefresh(
      project.id,
      "categories",
      "staff",
      "failed",
      startedAt
    );
    throw new Error(run.error ?? "Couldn't categorize the project.");
  }
  const picked = run.result.categoryIds;
  const outcome = await db.transaction(async (tx) => {
    // The lock serializes two Regenerates on one project; the comparison
    // catches a staff Save, which takes no lock, as long as it committed
    // before this read.
    await tx.execute(
      sql`select 1 from ${projects} where ${projects.id} = ${project.id} for update`
    );
    const current = (
      await tx
        .select({ id: projectCategories.categoryId })
        .from(projectCategories)
        .where(eq(projectCategories.projectId, project.id))
    )
      .map((r) => r.id)
      .sort();
    if (current.join() !== before.join()) {
      return "superseded" as const;
    }
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, project.id));
    await tx.insert(projectCategories).select(
      tx
        .select({
          projectId: sql<string>`${project.id}::uuid`.as("project_id"),
          categoryId: categories.id,
        })
        .from(categories)
        .where(inArray(categories.id, picked))
    );
    return "updated" as const;
  });
  await recordAiRefresh(project.id, "categories", "staff", outcome, startedAt);
  logRun(project.id, "regenerate", outcome, run, startedAt);
  return {
    outcome,
    categoryIds: await projectCategoryIds(project.id),
    proposal: outcome === "updated" ? run.result.proposal : null,
    attempt: await readAiRefresh(project.id, "categories"),
    regenerable: true,
  };
}

export async function regenerateProjectCategoriesForCurrentUser(
  data: ProjectCategorizationInput
): Promise<RegenerateCategoriesResult> {
  const viewer = await requireUser();
  return regenerateProjectCategoriesAs(viewer, data);
}

/**
 * Staff approve a proposed category: create it through `createCategoryAs`,
 * the path `/admin/categories` uses, then add it to the project (#31).
 *
 * The proposal reaches here from the browser, since it is never stored, so
 * the rules the tool schema put on the model are checked again: the type must
 * already exist and must not be Kind of work. A name already held under that
 * type is refused by the unique index, with the message staff see on the
 * Categories page.
 *
 * Adds rather than replaces, so a Save of the picker is not needed and the
 * other categories stay. Two steps, not one transaction: if the add fails the
 * category exists unattached, and staff can pick it.
 */
export async function approveProposedCategoryAs(
  viewer: AuthUser,
  data: ApproveProposedCategoryInput
): Promise<{ categoryId: string; categoryIds: string[] }> {
  assertStaff(viewer);
  const [project] = await db
    .select({ id: projects.id, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.deletedAt) {
    throw new Error("Restore the project before adding a category to it.");
  }
  const { types } = await listCategoryTypesImpl();
  if (data.type === KIND_OF_WORK_TYPE || !types.includes(data.type)) {
    throw new Error(
      `Pick an existing type other than ${KIND_OF_WORK_TYPE} for a new category.`
    );
  }
  const { id } = await createCategoryAs(viewer, {
    domain: "project",
    name: data.name,
    type: data.type,
    description: data.description,
  });
  await db
    .insert(projectCategories)
    .values({ projectId: project.id, categoryId: id })
    .onConflictDoNothing();
  return { categoryId: id, categoryIds: await projectCategoryIds(project.id) };
}

export async function approveProposedCategoryForCurrentUser(
  data: ApproveProposedCategoryInput
) {
  const viewer = await requireUser();
  return approveProposedCategoryAs(viewer, data);
}

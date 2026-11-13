import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  notExists,
} from "drizzle-orm";
import { db } from "#/db";
import { projectCategories, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { categoriesEnabled } from "#/lib/_internal/categories-flag";
import { buildCategorizeTool } from "#/lib/categorize";
import { KIND_OF_WORK_TYPE } from "#/lib/default-categories";
import { assertStaff } from "#/lib/viewer";
import type { CategorizeNextInput } from "../categories";
import {
  type CategorizeOutcome,
  categorizeProject,
  loadCategoryOptions,
} from "./project-categorize";

/**
 * The categorization backfill (#31): the back catalog had no categories, so
 * staff run the categorizer over it from `/admin/categories`. The browser
 * drives it one project per call with a running count and a stop button, as
 * placement runs in the browser (ADR-0056), so no server job outlives the tab
 * and a stop is a stop.
 *
 * Writes straight to published projects, without a review step: a wrong
 * category costs a search until staff fix it on the panel, and a review queue
 * of the whole catalog is the bottleneck #31 removes. Meters against no one's
 * AI limit; each call logs its tokens (`logRun`).
 */

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

/**
 * Published or archived, not deleted, and carrying no category: the projects
 * the backfill is for. A categorized project drops out of this by being
 * categorized, which is what lets a stopped run start again where it stopped.
 */
function uncategorized() {
  return and(
    inArray(projects.status, ["published", "archived"]),
    isNull(projects.deletedAt),
    notExists(
      db
        .select({ projectId: projectCategories.projectId })
        .from(projectCategories)
        .where(eq(projectCategories.projectId, projects.id))
    )
  );
}

/** Throws the reason the backfill cannot run, if there is one. */
async function assertCanRun(): Promise<void> {
  if (!categoriesEnabled()) {
    throw new Error(
      "Categorizing is turned off on this server (BEDROCK_CATEGORIES_ENABLED)."
    );
  }
  const tool = buildCategorizeTool(await loadCategoryOptions(), {
    allowProposal: false,
  });
  if (!tool) {
    throw new Error(
      `Add at least one Field and one ${KIND_OF_WORK_TYPE} category first.`
    );
  }
}

export async function countUncategorizedAs(
  viewer: AuthUser
): Promise<{ count: number }> {
  assertStaff(viewer);
  await assertCanRun();
  const [row] = await db
    .select({ count: count() })
    .from(projects)
    .where(uncategorized());
  return { count: row?.count ?? 0 };
}

export async function countUncategorizedForCurrentUser() {
  const viewer = await requireUser();
  return countUncategorizedAs(viewer);
}

export type BackfillStep =
  | { done: true }
  | {
      done: false;
      outcome: CategorizeOutcome;
      projectId: string;
      title: string;
    };

/**
 * Categorizes the next uncategorized project after `after`, in id order, and
 * says what happened. `after` is the run's cursor: a project the model fails
 * on stays uncategorized, and without it every later call would pick that
 * project again, a paid call each time. A new run starts from null and so
 * retries the failures once.
 */
export async function categorizeNextAs(
  viewer: AuthUser,
  data: CategorizeNextInput,
  invoke?: ResponsesFn
): Promise<BackfillStep> {
  assertStaff(viewer);
  await assertCanRun();
  const [next] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(
      data.after
        ? and(uncategorized(), gt(projects.id, data.after))
        : uncategorized()
    )
    .orderBy(asc(projects.id))
    .limit(1);
  if (!next) {
    return { done: true };
  }
  const outcome = await categorizeProject(next.id, invoke, "backfill");
  return { done: false, outcome, projectId: next.id, title: next.title };
}

export async function categorizeNextForCurrentUser(data: CategorizeNextInput) {
  const viewer = await requireUser();
  return categorizeNextAs(viewer, data);
}

import { createReferenceListCache } from "#/lib/_internal/reference-list-cache";
import { listCategoriesImpl } from "./categories";
import { listProgramsImpl } from "./programs";

async function loadProjectFilterOptions() {
  // One after the other, so a cold miss holds one connection rather than two.
  const { rows: categories } = await listCategoriesImpl({ domain: "project" });
  const { rows: programs } = await listProgramsImpl();
  return { categories, programs };
}

const cache =
  createReferenceListCache<
    Awaited<ReturnType<typeof loadProjectFilterOptions>>
  >();

/**
 * The project listing's two filter option lists, cached per task (#558,
 * ADR-0051). The listing reads them beside the search on every visit, and
 * they change a few times a term. Only the listing reads through here: the
 * staff pickers and admin pages call `listCategoriesImpl` and
 * `listProgramsImpl` directly, so an edit form never shows a stale list. One
 * key, so no caller can grow the cache. The category and program writers
 * clear it on the task that ran them.
 */
export function listProjectFilterOptionsImpl() {
  return cache.get("", loadProjectFilterOptions);
}

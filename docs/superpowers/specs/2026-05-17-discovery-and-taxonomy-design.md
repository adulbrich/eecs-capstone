# Spec 3: Discovery + Project Taxonomy

**Date:** 2026-05-17
**Status:** Draft (pending user review)
**Author:** Alexander Ulbrich (with Claude)
**Supersedes:** N/A
**Builds on:** [Spec 1: Auth Foundation](2026-05-15-auth-foundation-design.md), [Spec 2: Project Domain](2026-05-16-project-domain-design.md)
**Next specs:** Spec 4 (User admin), Spec 5 (Media).

## 1. Purpose

Turn the existing project list into a real discovery surface and ship the admin tooling that makes it useful. Full-text search across every project's title, description, problem statement, objectives, and qualifications, backed by Postgres `tsvector` + GIN. Filtering by category and program. Admin CRUD for the `categories` and `programs` tables, including instructor assignment per program. Staff-only category multi-select on the project form (per the README's "categories added by admins"). Replace the existing free-text Program-ID field with a real program dropdown for all roles. Ship project bookmarks (button on detail, "My bookmarks" view).

Spec 4 will add user admin (list, role change, ban/unban). Spec 5 will add media (S3 + project image uploads).

## 2. Goals

1. **Full-text search** over published projects via a stored `tsvector` generated column on `projects`, with weighted ranking (title A, description / problem B, qualifications / objectives C). GIN index for query speed.
2. **Category filter** (multi-select, AND across selections) and **program filter** (single select) on `/projects`. All filter + search state lives in the URL search params so links are shareable.
3. **Categories admin**: list / create / edit / delete at `/admin/categories`. Category type stays free text (per brainstorming); admin form suggests existing types as autocomplete to nudge consistency. Deleting a category cascades the `project_categories` join (already in schema).
4. **Programs admin**: list / create / edit / delete at `/admin/programs`. Per-program instructor management (add / remove). The `projects.program_id` FK is changed to `ON DELETE SET NULL` so program deletion does not block on linked projects; the admin confirmation dialog shows the linked-project count up front.
5. **Project form (Spec 2 component)**: free-text Program-ID field becomes a real dropdown from `listPrograms()` for every viewer. A new category multi-select is rendered **only for staff** and persisted via a separate `setProjectCategories` server function.
6. **Bookmarks**: bookmark button on project detail (authed only), "My bookmarks" route, idempotent server functions.
7. **Tests**: integration coverage for search ranking and filter semantics, categories and programs CRUD, bookmark idempotency.
8. **No regressions**: existing 10 + 8 unit and 13 integration tests stay green.

## 3. Non-Goals (deferred)

- User admin: list users, change role, ban / unban (Spec 4).
- Project image upload + S3 abstraction (Spec 5).
- Gen-AI category suggestions on project create / edit.
- Sort options on the public list. Stays fixed (rank-when-query, else `published_at desc`).
- Saved searches.
- Realtime search-as-you-type-as-server-pushes (we polling-free; the route loader runs on each navigate).
- Inventory module, bidding, assignments.
- Per-category-type filter dropdowns (deferred together with the per-type structuring, which the user opted out of).

## 4. Architecture

### 4.1 Server modules

Same pattern as Spec 2: client-importable wrapper file + server-only `_internal/` impl. Wrappers contain ONLY Zod + `createServerFn` and one dynamic import per handler. Impls hold the DB work.

| Path                                                      | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/search.ts` + `src/server/_internal/search.ts` | Single `searchProjects({query, categoryIds, programId, page, pageSize})` server fn. Public (no auth required), but returns only `status='published' AND deleted_at IS NULL`.                                                                                                                                                                                                                                               |
| `src/server/categories.ts` + `_internal/categories.ts`    | `listCategories` (public, used by filter + admin), `createCategory`, `updateCategory`, `deleteCategory`, `listCategoryTypes` (distinct values for the admin autocomplete), `setProjectCategories(projectId, categoryIds[])`. All mutations are staff-only.                                                                                                                                                                 |
| `src/server/programs.ts` + `_internal/programs.ts`        | `listPrograms` (public, used by filter + dropdown), `getProgram`, `createProgram`, `updateProgram`, `deleteProgram` (returns `{ unlinkedProjectCount }` after the cascade), `addProgramInstructor(programId, userId)`, `removeProgramInstructor(programId, userId)`, `listProgramInstructors(programId)`, `listEligibleInstructors()` (users with role `admin` or `instructor`, for the picker). All mutations staff-only. |
| `src/server/bookmarks.ts` + `_internal/bookmarks.ts`      | `addBookmark(projectId)`, `removeBookmark(projectId)`, `listMyBookmarks()`, `isBookmarked(projectId)`. All authed. Add / remove are idempotent.                                                                                                                                                                                                                                                                            |

### 4.2 Client modules

| Path                                       | Responsibility                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/projects-filter-bar.tsx`   | Search input (debounced 300ms), category multi-select, program select. Reads / writes via `Route.useSearch()` and `Route.useNavigate({ search: ... })`. Always resets `page` to 1 on filter change. |
| `src/components/category-chip.tsx`         | Small pill rendering the category `name`, with optional `type` tag in muted text. Used on project detail and admin tables.                                                                          |
| `src/components/category-multi-select.tsx` | TanStack Form-friendly multi-select (checkboxes inside a popover or simple stacked checkboxes). Only mounted by `project-form.tsx` when `showCategories` is true.                                   |
| `src/components/bookmark-button.tsx`       | Toggle button on project detail. Uses TanStack Query for optimistic update.                                                                                                                         |
| `src/components/program-select.tsx`        | Plain `<select>` populated from `listPrograms()`. Used in `project-form.tsx` and (single-select variant) the filter bar.                                                                            |
| `src/components/admin-table.tsx`           | Tiny shared `<table>` shell used by the categories and programs admin lists. Keeps both pages consistent without dragging in a table library.                                                       |
| `src/components/instructor-manager.tsx`    | The per-program "Instructors" section on the program edit page: lists current instructors with a remove button, plus an "Add instructor" picker fed by `listEligibleInstructors`.                   |

### 4.3 Existing files changed

- `src/db/schema.ts`: add `searchVector` column declaration on `projects` (read-only customType), change `projects.programId` FK from default `NO ACTION` to `ON DELETE SET NULL`.
- New migration: add the generated tsvector column, the GIN index, and the FK change (see Section 5).
- `src/components/project-form.tsx`: replace the free-text Program-ID input with `<ProgramSelect />`. Add the category multi-select gated on a new `showCategories` prop. When saving, if `showCategories` is true, call `setProjectCategories` after `updateProject` (sequential, both in the form's onSubmit).
- `src/routes/_authed/projects/new.tsx` and `.../$projectId/edit.tsx`: pass `showCategories={isStaff}` to the form. New page fetches the project's current category ids from the loader so edit forms preload them.
- `src/routes/projects/index.tsx`: swap loader from `listPublishedProjects` to `searchProjects`. Mount `<ProjectsFilterBar />`. Delete the now-orphaned `listPublishedProjects` wrapper and its impl.
- `src/routes/projects/$projectId.tsx`: show `<CategoryChip />` row, mount `<BookmarkButton />` for authed viewers.
- `src/routes/_authed/admin/index.tsx`: replace the "(coming in Spec 3)" placeholders for Categories and Programs with real `Link`s. Users stays placeholder.
- `src/components/site-header.tsx`: add "Bookmarks" link in the signed-in nav, between "My projects" and "New project".

### 4.4 Why these boundaries

- **One server-fn module per domain (`search`, `categories`, `programs`, `bookmarks`)** so a developer touching search never has to scroll past category code, and so the wrapper-plus-`_internal` split stays clean.
- **`category-multi-select` separate from `project-form`** because the staff-only path is the only place it appears in Spec 3; isolating it lets Spec 4 reuse it (e.g., bulk-edit) without untangling the project form.
- **`admin-table` and `program-select`** are not premature abstractions: they are each used twice in Spec 3 (categories + programs admin tables; project-form + filter bar respectively).
- **`projects-filter-bar` owns URL state**, not the page route. The page just declares its `validateSearch` schema. Lets us drop the same bar into other list views later (e.g., a "browse by program" page) without touching the bar's internals.

## 5. Data model

### 5.1 Migration: generated tsvector + GIN, programId FK rule

Single new migration. The tsvector column is `GENERATED ALWAYS AS ... STORED` so inserts / updates auto-recompute without a trigger.

```sql
ALTER TABLE projects
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(problem_statement, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(objectives, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(min_qualifications, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(pref_qualifications, '')), 'C')
    ) STORED;

CREATE INDEX projects_search_idx ON projects USING GIN (search_vector);

-- Change programId FK to SET NULL so deleting a program unlinks projects
-- (instead of blocking on RESTRICT).
ALTER TABLE projects DROP CONSTRAINT projects_program_id_programs_id_fk;
ALTER TABLE projects
  ADD CONSTRAINT projects_program_id_programs_id_fk
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
```

Weighted: title (A) outranks description / problem statement (B), which outrank qualifications / objectives (C). The internal `notes` field is excluded from search (it's staff-only data; we never want it influencing public results).

### 5.2 Drizzle TS declaration for the tsvector

Drizzle 0.45 does not have a built-in `tsvector` column type. Use the `customType` helper, declaring it as read-only (no value transformations because we never write to it from TS):

```ts
import { customType } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

// inside projects table:
searchVector: tsvector("search_vector").notNull(),
```

This compiles. Drizzle's introspection / migration generator will leave the column alone on subsequent `db:generate` runs (we write the migration SQL by hand). Document this in the schema file with a JSDoc.

### 5.3 No other table changes

`categories`, `programs`, `program_instructors`, `project_categories`, `project_bookmarks` are all in good shape from Spec 1. No new columns. The category-type free-text approach (the user's choice) needs no migration; we will just suggest existing types as autocomplete in the admin form.

## 6. Full-text search

### 6.1 Input shape

```ts
const searchInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  programId: z.string().uuid().nullable().default(null),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});
```

### 6.2 Query construction (Drizzle + sql template)

```ts
const conditions = [
  eq(projects.status, "published"),
  isNull(projects.deletedAt),
];

const trimmed = input.query.trim();
if (trimmed) {
  conditions.push(
    sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`
  );
}

if (input.programId) {
  conditions.push(eq(projects.programId, input.programId));
}

if (input.categoryIds.length > 0) {
  conditions.push(
    sql`${projects.id} IN (
      SELECT project_id FROM project_categories
      WHERE category_id = ANY(${input.categoryIds}::uuid[])
      GROUP BY project_id
      HAVING count(*) = ${input.categoryIds.length}
    )`
  );
}

const orderBy = trimmed
  ? sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${projects.publishedAt} DESC`
  : desc(projects.publishedAt);
```

### 6.3 Semantics

- **Search**: `websearch_to_tsquery` accepts user-typed strings safely. Handles `"exact phrase"`, `-exclusion`, `OR`. No manual escaping needed.
- **Category filter**: AND across selections. A project must have ALL selected categories. This is the user-friendly default in a multi-select context (selecting "react" and "healthcare" narrows the list).
- **Program filter**: single select. Exact match.
- **Empty query + no filters**: behaves identically to the old `listPublishedProjects` (paginated by `published_at desc`).
- **Pagination**: offset-based, page size capped at 50. Filter / search changes reset to page 1 (enforced in the filter bar, not the server).

### 6.4 Edge cases

- `websearch_to_tsquery` returns empty for inputs that are pure punctuation. We trim and check non-empty before applying. An empty effective query just shows the unranked recent list.
- A query that matches no rows returns an empty array and `total: 0`. The page renders "No projects matched your search."
- A `programId` filter pointing at a deleted program returns empty (the program is gone and no project references it).

## 7. Categories

### 7.1 Model

```ts
{
  id: uuid,
  name: string,
  type: string,    // free text, e.g. "technology", "industry", "field", "project_type"
  createdAt: timestamptz,
}
```

No DB enforcement on `type`. The admin form's autocomplete is fed by `listCategoryTypes` which returns `SELECT DISTINCT type FROM categories ORDER BY type`. Hint to the admin without locking them in.

### 7.2 Server functions

| Name                                                 | Auth                                                                              | Description                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `listCategories({ type? })`                          | Public                                                                            | All categories, optionally filtered by type. Used by the filter bar AND the admin table.                              |
| `listCategoryTypes()`                                | Public                                                                            | Distinct existing types, for the admin form autocomplete.                                                             |
| `getCategory(id)`                                    | Public                                                                            | Single category.                                                                                                      |
| `createCategory({ name, type })`                     | Staff                                                                             | `name` and `type` both required, max 100 chars each, trimmed, non-empty.                                              |
| `updateCategory({ id, name, type })`                 | Staff                                                                             | Same validation.                                                                                                      |
| `deleteCategory(id)`                                 | Staff                                                                             | Cascades `project_categories` (already configured `ON DELETE CASCADE` in Spec 1).                                     |
| `setProjectCategories({ projectId, categoryIds[] })` | Staff (and viewer must be allowed to see the project; same `canSeeProject` check) | Replaces the join rows for that project in a transaction (`DELETE ... WHERE projectId = ?` then `INSERT ... VALUES`). |

### 7.3 Admin UI

- `/admin/categories` lists every category in a table (Name, Type, Created, Edit / Delete). Inline "New category" form at the top.
- `/admin/categories/$id` is a small edit form plus a destructive Delete button with confirm dialog.

### 7.4 Where categories appear on projects

- **Project detail page**: `<CategoryChip />` row above the description, visible to everyone.
- **Project form (staff only)**: `<CategoryMultiSelect />` field. Saves via `setProjectCategories` AFTER `updateProject` succeeds. If category save fails the project save is already committed; the form surfaces the error banner.

## 8. Programs

### 8.1 Server functions

| Name                                                        | Auth   | Description                                                                                                                       |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `listPrograms()`                                            | Public | All programs, ordered by `courseId asc`. Used by program dropdown + admin table.                                                  |
| `getProgram(id)`                                            | Public | Single program with its instructor list.                                                                                          |
| `createProgram({ courseId, courseName, description? })`     | Staff  | All three trimmed; `courseId` and `courseName` required.                                                                          |
| `updateProgram({ id, courseId, courseName, description? })` | Staff  | Same validation.                                                                                                                  |
| `deleteProgram(id)`                                         | Staff  | Returns `{ unlinkedProjectCount }`. Programs.projectId FK is now `SET NULL` so deletion succeeds even when projects reference it. |
| `addProgramInstructor({ programId, userId })`               | Staff  | Refuses if user role is not `admin` or `instructor`.                                                                              |
| `removeProgramInstructor({ programId, userId })`            | Staff  | Idempotent.                                                                                                                       |
| `listProgramInstructors(programId)`                         | Public | Used to render the instructor list on the program edit page and (later) on the program detail page.                               |
| `listEligibleInstructors()`                                 | Staff  | Users with role `admin` or `instructor`, for the add-instructor picker.                                                           |

### 8.2 Admin UI

- `/admin/programs`: table (Course ID, Course Name, Instructors count, Projects count, Edit). Inline "New program" form.
- `/admin/programs/$id`: edit + delete (confirm dialog mentions `unlinkedProjectCount` from a pre-flight `getProgram` call) + instructor manager.

### 8.3 Where programs appear on projects

- **Project form**: `<ProgramSelect />` replaces the free-text Program-ID input. Lists every program ordered by `courseId`. Allowed value is any program id or empty (unassigned). Available to all viewers (proposer + staff).
- **Project detail**: a small "Program: COURSE-ID -- Course name" line under the title (only when assigned).

## 9. Bookmarks

### 9.1 Server functions

| Name                            | Auth   | Description                                                                                                                                                                            |
| ------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addBookmark({ projectId })`    | Authed | Inserts `(userId, projectId)`; `ON CONFLICT DO NOTHING` for idempotency. Viewer must be able to see the project.                                                                       |
| `removeBookmark({ projectId })` | Authed | Deletes the row; no-op if absent.                                                                                                                                                      |
| `isBookmarked({ projectId })`   | Authed | Returns `{ bookmarked: boolean }`.                                                                                                                                                     |
| `listMyBookmarks()`             | Authed | Joins `project_bookmarks` with `projects`, filtered to projects the viewer can still see (excludes soft-deleted, excludes drafts that aren't theirs). Ordered by `bookmarked_at desc`. |

### 9.2 UI

- `<BookmarkButton />` on the project detail page (right under the status badge or next to the Edit link). Toggles via TanStack Query mutation with optimistic update. Only renders for authed viewers (returns null otherwise).
- `/my/bookmarks` (authed): reuses `<ProjectCard />`. Empty state: "No bookmarks yet. Browse [projects](/projects) and click the bookmark icon to save one."

## 10. Header changes

Signed-in nav becomes: **Projects · My projects · Bookmarks · New project · Admin (staff)**. Same separators / styles as Spec 2's restructure. Signed-out nav unchanged.

Admin landing page (`/admin`):

- Active links: Projects (Spec 2), Categories (this spec), Programs (this spec).
- Placeholder: Users (Spec 4).

## 11. Routes

| Path                                     | Layout          | Component                                  | Notes                                                                      |
| ---------------------------------------- | --------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `/projects`                              | Public          | `projects/index.tsx` (modified)            | Replaces `listPublishedProjects` with `searchProjects`. Mounts filter bar. |
| `/projects/$projectId`                   | Public          | `projects/$projectId.tsx` (modified)       | Adds category chips row and bookmark button.                               |
| `/projects/new` and `/projects/$id/edit` | `_authed`       | (modified)                                 | Pass `showCategories={isStaff}` and program dropdown.                      |
| `/my/bookmarks`                          | `_authed`       | `_authed/my/bookmarks.tsx` (new)           | List of bookmarked projects.                                               |
| `/admin/categories`                      | `_authed/admin` | `_authed/admin/categories/index.tsx` (new) | List + inline create.                                                      |
| `/admin/categories/$id`                  | `_authed/admin` | `_authed/admin/categories/$id.tsx` (new)   | Edit + delete.                                                             |
| `/admin/programs`                        | `_authed/admin` | `_authed/admin/programs/index.tsx` (new)   | List + inline create.                                                      |
| `/admin/programs/$id`                    | `_authed/admin` | `_authed/admin/programs/$id.tsx` (new)     | Edit + delete + instructor manager.                                        |

All admin routes use the existing admin `beforeLoad` guard (admin OR instructor; the per-action gate inside server functions further restricts to staff for mutations, which is the same set in Spec 2's role model).

## 12. Testing

| Layer                    | What we cover                                                                                                                                                                                                                                                                                        | Tooling                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Integration (search)     | Title hit outranks qualifications hit for the same query. Program filter intersects with query. Two-category AND requires both. Soft-deleted / non-published never appear. Empty query falls back to recency. Phrase queries (`"some thing"`) work. Punctuation-only input returns the recency list. | Vitest against docker Postgres, same harness as Spec 1 / 2. |
| Integration (categories) | Create / update / delete round-trip. `deleteCategory` removes the row AND the join rows. `setProjectCategories` is staff-gated; running it as owner throws. `setProjectCategories` is transactional (atomic replace).                                                                                | Same harness.                                               |
| Integration (programs)   | Create / update round-trip. `deleteProgram` unlinks projects (`SET NULL` cascade) and reports the count. Instructor add refuses for a user role. Instructor remove is idempotent.                                                                                                                    | Same harness.                                               |
| Integration (bookmarks)  | Add is idempotent. Remove is idempotent. `listMyBookmarks` excludes soft-deleted projects. Viewer can only see their own bookmarks.                                                                                                                                                                  | Same harness.                                               |
| Pure (none new)          | No new pure modules; the workflow and visibility modules from Spec 2 are unchanged.                                                                                                                                                                                                                  | N/A                                                         |

No new browser / E2E tests. Manual smoke checklist in Section 14.

## 13. Risk callouts

1. **Generated tsvector locks weights into schema.** Changing field weights requires `DROP COLUMN search_vector` + re-add. Acceptable; document the migration shape. Adding a new searchable field (e.g., comments) also requires a migration. Adding a field to the existing weights is straightforward (drop column, re-add with the new field included).
2. **Drizzle TS-side tsvector via customType.** We declare it as read-only (no writes). `db:generate` may produce noise on the next migration if Drizzle thinks the column needs syncing; we hand-author the migration and ignore any drift hints. Worth flagging in the schema with a JSDoc.
3. **Program FK switched to `SET NULL`.** Existing data is fine because projects whose programs are deleted will simply have `program_id = NULL`. The migration drops + re-adds the constraint. Mid-migration there is a window where the constraint is absent; acceptable for our scale.
4. **Category type free text.** Per the user's choice. Risk: "Technology" and "technology" become two distinct types in the filter UI. Mitigation: the admin form autocomplete uses `listCategoryTypes()`. If drift appears in practice, a one-shot data fix beats premature DB constraints.
5. **`setProjectCategories` after `updateProject` is not atomic across the two calls.** The form does two sequential server calls. If `updateProject` succeeds and `setProjectCategories` fails, the project saves but the categories don't. Acceptable for v1 (the error banner shows; the user retries). If we ever need true atomicity, fold category replacement into `updateProject`'s transaction, but that complicates the per-domain server-fn split.
6. **`websearch_to_tsquery` edge cases.** Pure punctuation, lone hyphens. Server trims and checks non-empty before applying the search predicate. Worst case the user sees recency results.
7. **AND-across-categories** could feel restrictive when filters are large. We chose it because it's predictable in a multi-select. If users complain, switching to OR is a one-line query change.

## 14. Manual smoke checklist (post-implementation)

Run with two browser sessions (one staff, one non-staff).

1. **Search ranking.** Publish two projects: title "React UI Component Library" and another with "react" only in the description. Search `react` on `/projects`. The first ranks higher.
2. **Phrase + exclusion.** Search `"machine learning" -healthcare`. Projects with that phrase appear; ones tagged healthcare drop out.
3. **Category filter (AND).** Create categories "react" (type technology) and "healthcare" (type industry). Assign both to one project, only "react" to another. Filter by both → only the first project appears.
4. **Program filter.** Create program "CS-462 Capstone". Assign it to one of the projects. Filter by it → only that project. Combined with a search query, both predicates apply.
5. **Shareable URL.** Copy the URL with `?q=react&categories=...&program=...&page=2`. Paste in a new browser. Same results, same controls populated.
6. **Categories admin (staff).** `/admin/categories`: create, edit, delete. Delete confirms; the category disappears from the filter bar after a refresh. Confirm the autocomplete suggests existing types.
7. **Programs admin (staff).** `/admin/programs`: create program. Edit. Add an instructor (must have role admin or instructor; non-staff user is rejected by the picker). Remove an instructor. Delete a program with linked projects: confirmation dialog shows the linked-project count; after delete, the projects show "no program" and `programId IS NULL` in studio.
8. **Project form (staff).** Edit a project as admin. Set categories via multi-select; save. Edit the same project as the proposer; categories chips visible but no multi-select.
9. **Project form (proposer).** New project as a non-staff user. Program dropdown shows real programs (not a UUID field). Selecting one assigns; submitting without selecting leaves `programId = NULL`.
10. **Bookmarks.** Bookmark two projects as a regular user. Visit `/my/bookmarks`; both appear. Unbookmark one; refresh; only one remains. Bookmark a project, soft-delete it as admin, return to `/my/bookmarks`: the soft-deleted project is hidden.

## 15. Open questions

None. User confirmed: two-spec breakdown; category type stays free text; categories assigned by staff only; bookmarks and program dropdown included; AND across categories; generated tsvector column; FK switched to `SET NULL`.

## 16. Approval

Awaiting user review. Once approved, the next step is `superpowers:writing-plans` to produce the implementation plan.

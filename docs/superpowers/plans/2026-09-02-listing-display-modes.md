# Listing Display Modes Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, test first within each step, with a code review gate at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-responsive card and row modes on `/projects` with a responsive card mode and an `AdminDataTable` mode, add a bookmark control to both, widen the listing projection to every public field, and give `/inventory` the responsive card.

**Spec:** `docs/superpowers/specs/2026-09-02-listing-display-modes-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, docs, and string literals.
- **`projectDetailView` bounds what is public.** No new field reaches an anonymous payload.
- **No back-compat shims.** `row` is dropped, `sort` is renamed to `order`, nothing aliases either.
- **Test commands:** `ulimit -n 8192; CI=true npm test`; `ulimit -n 8192; CI=true npm run test:integration` (docker Postgres, truncates, so `npm run db:seed:dev` afterwards). Vitest needs the sandbox off in this environment.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **The public listing changes, so `npm run test:accessibility` and `npm run test:smoke` run before the PR.**
- **Stage files by name. Never commit to `main`.** Branch `feat/78-listing-display-modes`.

## Seams under test

| Seam | Kind |
| --- | --- |
| `readStoredView` / `writeStoredView` | unit |
| `ViewToggle` | unit, jsdom |
| `ProjectCard`, `InventoryCard` | unit, jsdom |
| `BookmarkSetProvider` + `BookmarkToggle` | unit, jsdom, server fns mocked |
| `PROJECT_TABLE_COLUMNS` rendered through `AdminDataTable` | unit, jsdom |
| `searchProjectsImpl` key set | integration |
| `listMyBookmarkIdsAs` | integration |
| `listMyBookmarksAs` key set | integration, updated |
| `/projects` table mode and toggle | accessibility suite |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/view-preference.ts` | `ViewMode = "card" \| "table"` |
| `src/components/view-toggle.tsx` | two buttons, `current` only |
| `src/components/project-card.tsx` | one responsive card with a bookmark slot |
| `src/components/project-row.tsx`, `project-list-item.tsx` | deleted |
| `src/components/inventory-card.tsx` | one responsive card |
| `src/components/inventory-row.tsx` | deleted |
| `src/components/bookmark-set.tsx` | provider, hook, `BookmarkToggle` |
| `src/components/project-table-columns.tsx` | public column list and default sort |
| `src/server/_internal/project-summary.ts` | widened projection, shared `categoriesOf` |
| `src/server/_internal/projects-queries.ts` | export select narrowed |
| `src/server/_internal/bookmarks.ts`, `src/server/bookmarks.ts` | `listMyBookmarkIds` |
| `src/server/__tests__/access-contract.ts` | new entry |
| `src/routes/projects/index.tsx` | two modes, `order` param, narrowed `loaderDeps` |
| `src/components/projects-filter-bar.tsx` | `order` prop |
| `src/routes/inventory/index.tsx`, `inventory-filter-bar.tsx` | toggle and `view` removed |
| `src/routes/_authed/my/projects.tsx`, `my/bookmarks.tsx` | `ProjectCard` in a column list |
| `src/routes/_authed/admin/projects/index.tsx` | CSV gains NDA column |
| `src/test/a11y/public.a11y.test.ts` | table mode coverage |
| `docs/UI-CONVENTIONS.md`, `docs/QUIRKS.md`, `PRD.md` | updated |

---

## Phase 1: preference and toggle

- [ ] **Step 1.1** `view-preference.test.ts`: a stored `row` reads `null`; `table` round-trips. Red, then change the type and guard.
- [ ] **Step 1.2** `view-toggle.test.tsx`: clicking "Table view" writes `table` to storage and navigates with `view: "table"`. Red, then rewrite `ViewToggle` with `current` only, `Table` icon, new labels.
- [ ] **Step 1.3** `use-seed-view.test.tsx` compiles against the new type without edits beyond the literal.

## Phase 2: server projection

- [ ] **Step 2.1** `search.integration.test.ts`: `searchProjectsImpl` returns exactly the public key set (sorted literal). Red, then widen `projectSummarySelect`, move `categoriesOf` into `project-summary.ts`, narrow `adminProjectSummarySelect` and the export select, add the CSV column.
- [ ] **Step 2.2** `bookmarks.integration.test.ts`: update the key-set literal.
- [ ] **Step 2.3** `bookmarks.integration.test.ts`: `listMyBookmarkIdsAs` lists the viewer's own ids and not another viewer's. Red, then add `*As`, `*ForCurrentUser`, the wrapper, and the access-contract entry. `seam-convention.test.ts` and `access-contract.test.ts` in `npm test` stay green.

## Phase 3: bookmark set and responsive card

- [ ] **Step 3.1** `bookmark-toggle.test.tsx`: outside a provider renders nothing; inside one with a signed-in session and the id in the set, renders "Remove bookmark"; click calls `removeBookmark` and flips the label; a rejected call reverts. Red, then write `bookmark-set.tsx`.
- [ ] **Step 3.2** `project-card.test.tsx`: image classes carry `aspect-[16/9] w-full md:aspect-[3/2] md:w-40`; the card root is not an anchor; the link is a descendant; no button renders without a provider. Red, then merge the row into `ProjectCard`, delete `project-row.tsx`, `project-list-item.tsx` and `project-row.test.tsx`.
- [ ] **Step 3.3** `inventory-card.test.tsx`: same layout assertions. Red, then merge `InventoryRow` in and delete it.

## Phase 4: the table

- [ ] **Step 4.1** `project-table-columns.test.tsx`: rendered through `AdminDataTable` with a fixture row, the default-hidden set is the six prose columns plus URL; a prose cell carries `line-clamp-3` and `max-w-xs`; the NDA cell reads "Required"; the URL cell is a link once shown; the Title cell holds a thumbnail, the link, and the toggle inside a provider. Red, then write `project-table-columns.tsx`.

## Phase 5: routes

- [ ] **Step 5.1** `/projects`: `view` enum `card | table` with `.catch(undefined)`; `sort` renamed `order`; `cols`, `dir`, `sort` added; `loaderDeps` narrowed; `useAdminTable` with `storageKey: "public-projects"`; `BookmarkSetProvider` around both modes; card mode is the bounded column list.
- [ ] **Step 5.2** `ProjectsFilterBar`: `sort` prop becomes `order`.
- [ ] **Step 5.3** `/inventory` and `InventoryFilterBar`: drop `view`, the toggle, and the seed hook; render the column list.
- [ ] **Step 5.4** `/my/projects` and `/my/bookmarks`: `ProjectCard` in the column list.
- [ ] **Step 5.5** `npm run check`, `npm run typecheck`, `npm test`, `npm run test:integration`; reseed.

## Phase 6: accessibility and smoke

- [ ] **Step 6.1** `public.a11y.test.ts`: the four cases in the spec's test section.
- [ ] **Step 6.2** `npm run test:accessibility` (public suite at least, admin projects list too) and `npm run test:smoke`.

## Phase 7: docs and review

- [ ] **Step 7.1** `UI-CONVENTIONS.md`, `QUIRKS.md`, `PRD.md`.
- [ ] **Step 7.2** Push, open the PR, run `mattpocock-skills:code-review` until a pass raises nothing unanswered.

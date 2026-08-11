# Bookmark and Avatar Seams Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the six `*ForCurrentUser` functions that have no `*As` twin the seam the other 51 already have, and replace the two bookmark tests that do not call the code they claim to test.

**Architecture:** Each of the six splits into `xAs(viewer, ...)` plus a two-line `xForCurrentUser(...)`. No behavior changes. The avatar functions read `viewer.image`, so that file's viewer type gains an optional `image` field, which the session user already carries.

**Spec:** `docs/superpowers/specs/2026-08-11-bookmark-and-avatar-seams-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.**
- **No behavior change**: same queries, same errors, same return shapes, same `*ForCurrentUser` names called by `src/server/*.ts`.
- **The ~50 shallow wrappers are not touched.**
- **No migration, no wire-format change.**
- **Test commands:** `ulimit -n 8192; CI=true npm test` / `npm run test:integration` (docker Postgres; truncates, so `npm run db:seed:dev` before any accessibility run).
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name. Never commit to `main`.** Branch: `refactor/bookmark-and-avatar-seams`.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/server/_internal/bookmarks.ts` | four `*As` functions, four two-line wrappers |
| `src/server/_internal/uploads.ts` | `uploadAvatarAs`, `clearAvatarAs`, their wrappers, viewer gains `image` |
| `src/server/__tests__/bookmarks.integration.test.ts` | rewritten to call the functions |

---

## Phase 1: the bookmark seam

- [ ] Split all four into `*As(viewer, ...)` plus a two-line `*ForCurrentUser`. Move the bodies verbatim; the only edit is `viewer` arriving as a parameter instead of from `requireUser()`.
- [ ] `addBookmarkAs` keeps its `canSeeProject` check exactly as written, including the `{ id, role: role ?? null }` adaptation, so this phase changes nothing.
- [ ] `check`, `typecheck`, `npm test`, and the integration suite green with no test edits yet. The existing two tests do not call this code, so they cannot detect a mistake here; that is the point of Phase 2 and worth stating in the commit.
- [ ] Commit: `refactor(bookmarks): give the bookmark path an As seam`

## Phase 2: tests that call the code

- [ ] Replace both existing tests. Neither calls a bookmark function today, and the second re-implements the join it asserts on.
- [ ] New cases through the seam: a bookmark on a project the viewer may not see throws; adding twice is idempotent; a soft-deleted project drops out of the listing; removing is scoped to the viewer so one person cannot remove another's; `isBookmarkedAs` reflects both states.
- [ ] Confirm the authorization test fails if `canSeeProject` is removed from `addBookmarkAs`, so it discriminates rather than passing vacuously.
- [ ] Commit: `test(bookmarks): test the bookmark path instead of Postgres`

## Phase 3: the avatar seam

- [ ] Split `uploadAvatarForCurrentUser` and `clearAvatarForCurrentUser` into `*As` plus wrappers. The viewer type gains `image?: string | null`.
- [ ] Leave `uploadProjectImageAs` alone; it already follows the convention.
- [ ] Add integration coverage through `clearAvatarAs`, which is the one with no storage dependency: it nulls the column and tolerates a viewer with no previous image.
- [ ] `check`, `typecheck`, integration green.
- [ ] Commit: `refactor(uploads): give the avatar path an As seam`

## Phase 4: record the decision that was not taken

- [ ] `docs/QUIRKS.md`, workflow conventions: extend the "*As first, *ForCurrentUser second" entry to say that collapsing the two-line wrappers into one generic adapter was considered and rejected, with the reason (grep-ability, and the seam is the integration-test surface). The existing entry says what to do without saying what was rejected, which is the gap that let a review propose it.
- [ ] Note that all 57 now follow the pattern, so a future audit finding an exception has found a bug rather than a style difference.
- [ ] Commit: `docs(quirks): record why the ForCurrentUser wrappers stay`

## Phase 5: verify and open the PR

- [ ] `check`, `typecheck`, `npm test`, `build`, `check:compression`, `test:integration` clean. Accessibility is unaffected (no UI change) but run it if anything surprising turns up.
- [ ] Push, open the PR, wait for CI.

## Risks

| Risk | Mitigation |
| --- | --- |
| The move drops a check | Bodies move verbatim; Phase 2's tests then cover the check that had none |
| The existing tests give false confidence in Phase 1 | Stated openly: they do not call this code, so Phase 1 is verified by review and typecheck, and Phase 2 is what actually covers it |
| The avatar viewer type change ripples | Only two functions read `image`, and the field is optional |

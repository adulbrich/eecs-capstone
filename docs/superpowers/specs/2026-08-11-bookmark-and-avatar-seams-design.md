# Bookmark and avatar seams: design

Date: 2026-08-11

Fifth and last candidate from the architecture review of
`src/server/_internal/inventory.ts`. The review proposed collapsing 57
`*ForCurrentUser` wrappers into one adapter. Checking the 57 found the opposite
problem.

The governing principle:

> **A convention is only worth keeping if the places that skipped it are worse
> off. Six of them are, and that is the change worth making.**

---

## The 57 are not one thing

| Shape | Count | What they are |
| --- | --- | --- |
| Two lines | ~50 | `const viewer = await requireUser(); return xAs(viewer, data);` |
| The implementation itself | **6** | No `*As` twin at all |

The 50 are the convention working as designed, and `QUIRKS.md` gives a stated
reason to keep them: grep-ability over line count. Collapsing them would touch
eleven files to remove something no reader is confused by. **They stay**, and
this design records why so a future review does not re-propose it.

The 6 are the problem:

- **`src/server/_internal/bookmarks.ts`** has four `*ForCurrentUser` functions
  and **zero** `*As` functions. `addBookmarkForCurrentUser` performs a project
  lookup, a `canSeeProject` authorization check, and the insert.
- **`src/server/_internal/uploads.ts`** has `uploadAvatarForCurrentUser` and
  `clearAvatarForCurrentUser` with no seam, alongside
  `uploadProjectImageAs`, which follows the convention correctly.

## The tests degraded exactly as the convention predicts

`QUIRKS.md` states the `*As` pattern exists because `requireUser()` blocks
integration tests. Where the convention was skipped, that is what happened.
`bookmarks.integration.test.ts` has two tests and **neither calls a bookmark
function**:

| Test | What it actually does |
| --- | --- |
| "idempotent insert via ON CONFLICT DO NOTHING" | `db.insert(projectBookmarks)` twice, directly |
| "listMyBookmarks join filters out soft-deleted projects" | writes its own copy of the join and asserts on that |

The second re-implements the query it claims to cover, so it passes whether or
not `listMyBookmarksForCurrentUser` is correct. Net effect:
`addBookmarkForCurrentUser`'s authorization check has **no test at all**, and
the module's only real coverage is of Postgres.

This is the concrete cost of the missing seam, and the reason this is a live
risk rather than an aesthetic one.

## Design

Each of the six splits into the pattern the other 51 already follow:

```
xAs(viewer, ...)          // the implementation, integration-testable
xForCurrentUser(...)      // resolves the viewer, two lines
```

Nothing else changes. Same queries, same authorization, same return shapes,
same server functions calling the same `*ForCurrentUser` names.

### The avatar viewer needs one more field

`uploadAvatarAs` and `clearAvatarAs` read `viewer.image` to delete the previous
object from storage, which `AuthUser` in that file does not carry. The viewer
type gains an optional `image`, which is what the session user already
provides. `uploadProjectImageAs` is unaffected.

### Tests through the new seam

The two fake bookmark tests are replaced with tests that call the functions:

- adding a bookmark to a project the viewer may not see throws, which is the
  check that currently has no coverage at all
- adding twice is idempotent, through `addBookmarkAs` rather than through a
  raw insert
- a soft-deleted project drops out of the listing, through
  `listMyBookmarksAs` rather than through a hand-written join
- removing is scoped to the viewer, so one person cannot remove another's
- `isBookmarkedAs` reflects both states

## Constraints

- **No behavior change.** Same queries, same errors, same shapes. The server
  functions in `src/server/*.ts` keep calling the same names.
- **No wire-format change.**
- **No migration.**
- **The 50 shallow wrappers are not touched.**

## Deliberately not in scope

- **Collapsing the ~50 pass-throughs.** Rejected, and recorded in
  `QUIRKS.md` with the reason, which is the gap that let this candidate reach a
  review report in the first place: the existing entry says what to do without
  saying what was considered and rejected.
- **Creating `docs/adr/`.** A change to how this repo records decisions, and
  the owner's call to make separately rather than under a refactor.

## What this buys

- **An untested authorization check gains a test.** `canSeeProject` on the
  bookmark path is currently unverified.
- **Two tests stop lying.** A test that re-implements its subject passes
  regardless of whether the subject works.
- **Consistency that costs nothing**: 57 of 57 follow one pattern, so the next
  reader does not have to work out why six modules are different.

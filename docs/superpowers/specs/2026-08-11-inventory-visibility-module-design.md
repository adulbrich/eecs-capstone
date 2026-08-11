# Inventory visibility as a module: design

Date: 2026-08-11

Third candidate from the architecture review of `src/server/_internal/inventory.ts`.
Projects has a pure, client-safe, unit-tested visibility module. Inventory makes
the same decisions inside a 1600-line server-only file that no unit test can
import.

The governing principle:

> **A rule that two places compute separately is a rule that will eventually
> disagree with itself. Give it one home and derive both uses from it.**

---

## Current behavior

### The staff predicate is already shared, and inventory missed it

`src/lib/project-visibility.ts` exports `isStaff`, and ten files import it
across **seven non-project domains**: categories, programs, users, comments,
uploads, admin, bookmarks. Inventory keeps a private copy.

| | Count | Where |
| --- | --- | --- |
| `isStaff` definitions | 2 | `project-visibility.ts` (exported), `_internal/inventory.ts` (private) |
| `assertStaff` definitions | 5 | inventory, inventory-transitions, programs, categories, users |

Three of the five `assertStaff` wrap the shared `isStaff`; two inline the role
comparison. The module's *name* is also wrong for seven of its consumers, and
that is a symptom rather than the disease: a domain module owns something that
is not domain-specific.

### The retired rule contradicts itself

This is the substantive bug, not just duplication.

| Where | Rule |
| --- | --- |
| SQL, `buildInventoryScope` | `ne(status, "retired")`, applied to the public listing **and** `listAdminInventoryAs` |
| JS, `loadInventoryItemRowFor` | retired hidden from non-staff only; staff may open one |

So staff can read a retired item by URL but cannot find one in any listing.
That matters because `hardDeleteInventoryItemAs` permits deletion only when the
status is `available` or `retired`, and `QUIRKS.md` instructs staff to "use
retire for anything that has been requested". Staff are told to retire things
and then given no way to list them afterwards.

### Inventory's projection is the better one, and stays

The review's original framing was that inventory should mirror projects. On the
leak axis that is backwards:

| | Projects | Inventory |
| --- | --- | --- |
| Shape | one type, fields nulled for non-staff | two types, public built field by field |
| A new staff-only column | **leaks by default**, rides the SSR payload unless nulled | cannot leak, it is not copied |
| Hazard documented in `QUIRKS.md` | yes, an entry exists warning about it | none needed |

What inventory is missing is not the strategy, it is the **seam**. The strategy
moves out unchanged. Whether projects should later adopt the explicit shape is
a real question and a separate change, because it alters the public projects
payload.

---

## Design

### `src/lib/viewer.ts`

Owns the two role questions, and nothing else:

- `isStaff(viewer)`
- `assertStaff(viewer)`, throwing `Forbidden`

`project-visibility.ts` and the new inventory module both import it, and the
five hand-rolled `assertStaff` definitions collapse into it. Taking the shared
thing out of a domain module is what fixes the misnaming, rather than widening
that module's name to cover domains it should not know about.

`assertStaff` keeps the `asserts viewer is NonNullable<Viewer>` signature the
inventory copy has, because several call sites rely on the narrowing.

### `src/lib/inventory-visibility.ts`

Pure, client-safe, unit tested, in the same shape as `project-visibility.ts`.
It defines its input types structurally rather than importing the Drizzle row
type, which is the precedent `project-visibility.ts` already sets.

**One rule, two consumers.** Retired is staff-only wherever it appears:

```
canSeeRetired(viewer) = isStaff(viewer)
```

Both of the following derive from it, which is what makes the contradiction
above unrepresentable rather than merely fixed once:

- `visibleStatuses(viewer, { retiredOnly })` returns the set of statuses a
  listing may show. **Data, not a predicate**, because data crosses the SQL
  boundary and a predicate does not. `buildInventoryScope` builds its `inArray`
  from this instead of hard-coding `ne(status, "retired")`.
- `canReadInventoryItem(item, viewer)` answers the single-row question that
  `loadInventoryItemRowFor` asks.

Listing and detail stay different questions on purpose: a listing decides what
to show by default, a detail page decides whether this person may read this
row. Staff opening a retired item by URL is correct and stays. What was wrong
was that no listing could produce that URL.

The two projections move as they are, renamed only for the new home:
`publicItemView` and `staffItemView`, with `InventoryItemPublic` and
`InventoryItemStaff` moving with them. Those types are currently re-exported
through `src/server/inventory.ts` for `edit.tsx`; that re-export stays, so no
consumer changes.

### The staff-only retired filter

`/admin/inventory` gains a `retiredOnly` boolean search param and a
`FilterSwitch` labelled "Show only retired", mirroring "Show soft-deleted" on
`/admin/projects`.

- Default off, so the admin listing is unchanged from today.
- On, the listing shows **only** retired items.
- The status `Select` is **disabled** while it is on. Retired cannot co-occur
  with any status the dropdown offers, so the two controls could otherwise
  express an empty intersection; a control that is on screen, set, and quietly
  ignored is worse than one that is visibly unavailable.
- The public listing never gets this. `listInventorySchema` does not gain the
  param, and `visibleStatuses` ignores `retiredOnly` for a non-staff viewer, so
  a hand-crafted request cannot reach retired rows either.

## Constraints

- **The public listing's behavior does not change**, and there is a test to
  that effect: a non-staff viewer never sees a retired item, whatever is asked
  for.
- **The admin listing's default does not change.** Retired appears only when
  the new switch is on.
- **No wire-format change to the item views.** `InventoryItemPublic` and
  `InventoryItemStaff` keep their fields, so the CSV export columns and
  `edit.tsx`'s type guard are untouched.
- **No migration.**

## Deliberately not in scope

- **Moving projects to the explicit projection.** Recorded as the follow-up
  this design argues for, not done here.
- **Candidates 4 and 5** from the review: the overdue derivation, and the 57
  `ForCurrentUser` wrappers.
- **A `retired` option in the admin status dropdown.** The switch covers it,
  and two ways to ask the same question is the pattern this change is removing.

## What this buys

- **Locality.** The retired rule has one home, and the SQL is derived from it
  rather than written to agree with it.
- **Leverage.** One `isStaff` behind eight domains instead of two definitions,
  and one `assertStaff` instead of five.
- **The interface becomes the test surface.** Every inventory visibility
  decision becomes unit testable in `npm test` with no docker, which is what
  `project-visibility.test.ts` already gets for projects.
- **A bug staff actually hit** goes away: retired items become findable.

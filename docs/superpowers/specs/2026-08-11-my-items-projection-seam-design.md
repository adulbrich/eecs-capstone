# The `/my/items` projection seam: design

Date: 2026-08-11

Top candidate from the architecture review of the inventory and projects hot
spots. The review looked for a shallow module to deepen and found something
smaller and worse: a seam that exists, works, and has one caller routing around
it.

The governing principle:

> **A projection function guarantees only what passes through it. Nothing in the
> type system says every read path must.**

---

## `publicItemView` does its job. Two of three callers use it.

`src/lib/inventory-visibility.ts` builds its result field by field, so adding a
column to `inventory_items` cannot widen `/inventory` or `/inventory/:id`. That
part of `QUIRKS.md` is accurate.

There is a third non-staff read path. `listMyItemsAs`
(`src/server/_internal/inventory.ts:1023`) calls neither view. Its three queries
select whole Drizzle table objects and the return value spreads the joined rows:

```ts
// src/server/_internal/inventory.ts:1017-1021
| { kind: "hold"; item: typeof inventoryItems.$inferSelect }
```

So a column added to `inventory_items` tomorrow, with nobody touching this file,
appears on `/my/items` on day one.

`QUIRKS.md:670` states the guarantee without that qualification:

> `publicItemView` names every field it returns, so a new column on
> `inventory_items` cannot ride the public payload by default.

As written that is false, and it is the sentence most likely to stop a future
reader from checking.

## What ships today

Blast radius is the viewer's own held or requested items, not anyone else's.
That makes this a contradiction between the docs and the code rather than a
cross-account exposure, and it is still the whole reason the seam was built.

| Source | Fields on the payload that no consumer reads |
| --- | --- |
| `inventory_items` | `serial`, `notes`, `label`, `location` (all `staffItemView`-only), the five `currentHolder*` columns, `currentRequestItemId`, `description`, `imageUrl`, `createdAt`, `searchVector` |
| `inventory_request_items` | `reviewedBy`, `reviewedAt`, `reviewComment`, `closedBy`, `closedAt`, `requestId`, `itemId`, `updatedAt` |
| `inventory_requests` | the entire row, on every entry, in both halves |

`searchVector` is declared on the table, so it is part of `$inferSelect` and is
selected by `item: inventoryItems`. Both existing views drop it by naming their
fields. Confirm its presence on the wire during implementation; it is a payload
concern rather than a privacy one.

The staff review columns are the part the original review missed. `reviewedBy`
names which staff member decided a request.

## Design

Two new projections beside `publicItemView` and `staffItemView`, in the module
that already owns which fields leave the server:

```ts
export function holdItemView(row: HoldItemRow): HoldItemView;
export function myRequestLineView(row: RequestLineRow): MyRequestLineView;
```

`holdItemView` returns `id`, `name`, `status`, `pickupBy`, `dueAt`, `updatedAt`.
`myRequestLineView` returns `id`, `status`, `pickupBy`, `dueAt`, `createdAt`,
`closedReason`. Both type `status` as `ItemStatus`, not `string`.

Each of the three entry shapes says what it is. Only a hold carries an item as
its subject, because only a hold has no request line. The other two carry a
line, plus the item's name and status:

```ts
type ActiveEntry =
  | { kind: "hold"; item: HoldItemView }
  | { kind: "request"; itemName: string; itemStatus: ItemStatus;
      line: MyRequestLineView; collectedBy: CollectedBy | null };

type HistoryEntry =
  { itemName: string; line: MyRequestLineView; collectedBy: CollectedBy | null };
```

### The decisions behind that, and why

- **A sibling projection, not a reuse of `publicItemView`.** That function
  requires a `categories` argument, and categories come from a correlated
  raw-SQL subquery (`inventory.ts:148-153`) that a join would break, because it
  multiplies rows and corrupts the `count(*)` pagination. Adding it here means
  replicating that subquery into three more selects to fetch data the page never
  renders. The module holding a third projection for a third audience is its
  existing shape, not a new pattern.

- **`pickupBy` / `dueAt`, not `currentPickupBy` / `currentDueAt`.**
  `publicItemView` already renamed these, and two names for one concept inside
  one module is what the `hold.ts` work removed. This changes the hold arm of
  `deadlinePairOf` (`src/lib/inventory-deadlines.ts:90-96`) and the fixture
  builders in `src/lib/__tests__/inventory-deadlines.test.ts` and
  `src/test/overdue-badge.test.tsx`. `deadlinePairOf` itself survives: it exists
  because it knows *which object* carries the pair, and a hold's living on the
  item while a request's lives on the line stays true after any rename.

- **The request arm carries `itemName` and `itemStatus`, not an item view.**
  This is what makes the rename above safe. Had the request arm kept a full item
  view, one entry would carry `item.pickupBy` (the item's *current* hold
  deadline) beside `line.pickupBy` (that request line's deadline): the same name
  on two columns with different meanings, where today the different names are
  what stop you reading the wrong one. The arm never needed the item's dates
  anyway. It renders `item.name` and `item.status` only, and `deadlinePairOf`'s
  request arm reads `entry.item.status` alone, because a request's deadline
  lives on its line.

  `item.status` is load-bearing beyond the badge: `items.tsx:175-177` gates the
  Cancel button on `item.status !== "checked_out"`, which is what stops a
  requester cancelling an item a teammate has already collected. Requester and
  holder are both listed when they differ, so this arm is exactly what the
  requester sees for an item in someone else's hands. `itemStatus` keeps it.

  Cost: `DeadlineEntry`'s request arm changes from `item: { status }` to
  `itemStatus`, so that module and its fixtures take a second edit.

- **The views type `status` as `ItemStatus`.** `InventoryItemRow` and
  `InventoryItemPublic` both declare `status: string`, so `publicItemView`
  returns `string` and every consumer casts. The two new views therefore do
  **not** take `InventoryItemRow`: they declare their own input type with
  `status: ItemStatus`, which the Drizzle row already satisfies because the
  column is an enum. Narrowing through the parameter rather than casting inside
  is what keeps the call sites clean. Contained to these two; narrowing the
  existing types is a separate pass.

- **`updatedAt` stays on the projection, and the sort runs after it.** It is
  read only by `recencyOf`, the tie-break in `compareByDeadline`, and the page
  never renders it. Sorting raw rows first and projecting after would keep it
  off the wire, at the cost of the server sorting one shape while the client's
  `OverdueBadge` calls `deadlinePairOf` on another. One shape crossing one pure
  module is worth one timestamp.

- **History carries `itemName`, not an item view.** It renders exactly one item
  field (`items.tsx:234`). It also renders the outcome from `line.status`, which
  stays. Shipping the item's *current* status and dates on a *closed* line
  describes the present, not the record: a returned item reads `available`, or
  `checked_out` if someone else has it now. Flattening to a name makes that
  unrepresentable rather than merely unlikely, and it is the same shape the
  request arm takes above, minus the status nothing on this tab gates on.

- **`request` is dropped entirely.** `entry.request` and `history[].request` are
  read by no consumer, no component, and no test assertion.

- **`reviewComment` is dropped.** `inventory-transitions.ts:591-597` writes it
  and `closedReason` from the same string, and says so: "The comment does double
  duty as the reason and the review note." The route already renders
  `closedReason` (`items.tsx:243`), and the staff field is already labelled
  "Reason (sent to requester)" (`admin-request-queue-row.tsx:152`). Dropping the
  duplicate copy changes nothing anyone sees.

- **The projection is applied in JS; the selects keep `item: inventoryItems`.**
  Naming the columns in SQL would keep them out of the server process, but it
  moves the rule into three query literals inside a 1648-line file and leaves
  nothing for `npm test` to exercise. `src/lib/inventory-visibility.ts:9-15`
  records the SQL-side strategy as the one inventory deliberately declined.

- **`DeadlineEntry` stays structurally typed.** Its comment says it avoids
  importing `ActiveEntry` because that type "carries Drizzle row types and would
  not cross to the client." After this change that is no longer true, so the
  comment is corrected in the same commit. The type itself stays: a pure module
  declaring its own minimum requirement is depth, not duplication. Its two arms
  both move, the hold arm for the rename and the request arm to `itemStatus`.

## Tests

- **Unit**, mirroring the `carries only` / `omits every staff-only field` pair
  that `src/lib/__tests__/inventory-visibility.test.ts:105-138` already runs
  against `publicItemView`, for both new views. Names the excluded fields
  explicitly so the omission is intentional.
- **Integration**, one exact-key-set assertion on the payload:
  `expect(Object.keys(entry.item).sort()).toEqual([...])`. The field-by-field
  projection cannot widen on its own, but the thing that actually broke here was
  a `db.select()` upstream of it. This is the only assertion that fails when a
  fourth read path is written the same way.

## Constraints

- **The wire format changes.** This is not a no-op refactor: fields leave the
  SSR payload of `/my/items`. Every one of them is unrendered today.
- **No behavior change.** Same rows, same ordering, same errors.
- **No migration.**
- **`QUIRKS.md:670` is corrected as part of the change**, and records that the
  claim was false rather than being quietly rewritten, following
  `b078f24 docs(quirks): correct the overdue badge claim` and the deadlines
  entry's "An earlier version of this entry claimed those badges already
  existed; they did not."

## Deliberately not in scope

- **`cart`.** `getCartAs` already returns a named projection. It ships `addedAt`
  and `imageUrl` that the route does not render, which is untidy and not a leak.
  Named here so the next reviewer does not re-find it.

- **One view for cart, active and history with the tabs filtering by status.**
  Considered and rejected. The three are different row sources: cart is
  `inventory_cart_items`, and a hold is an item whose `current_holder_id` is the
  viewer with **no request line at all**, which is why `ActiveEntry` is a union
  today. A hold has no line status to filter on, because its state lives on the
  item. The orderings differ too (cart by `addedAt`, active by deadline, history
  by `updatedAt` with `limit 50`). The unified entry would be the union of three
  sets of needs with most fields absent on most rows, which is the wide shape
  this design removes, rebuilt one level up. If a second consumer ever wants it,
  it earns its own spec.

- **Promoting the staff reject notice from a placeholder to a persistent hint.**
  `admin-request-queue-row.tsx:152` warns that the reason reaches the requester,
  but a placeholder disappears once staff start typing. Real, two lines, and
  unrelated to a projection seam.

- **Narrowing `InventoryItemRow` and `InventoryItemPublic` to `ItemStatus`.**
  The right eventual state, and it would remove the status casts on `/inventory`
  and `/admin/inventory` too. It touches paths this change does not otherwise
  go near, so it earns a small pass of its own. Related: `InventoryStatusBadge`
  declares its own copy of the six-string union rather than importing
  `ItemStatus`, which that pass should fold in.

- **The projects equivalent.** `getProjectAs` returns the whole row and strips
  afterwards, in two places. It was candidate 3 of the same review and changes
  the public projects payload, so it is its own spec.

- **Creating a `CONTEXT.md`.** The architecture-review skill that produced this
  candidate keeps domain terms in a `CONTEXT.md`. This repo already routes that
  job to `docs/QUIRKS.md`, which `CLAUDE.md` names as the ground truth, so
  `holdItemView` and `myRequestLineView` are recorded there. A second glossary
  would be the parallel structure this project's conventions reject.

## What this buys

- **The documented guarantee becomes true.** Three of three non-staff read paths
  go through the module, so the sentence in `QUIRKS.md` describes the codebase.
- **Locality**: one module decides what leaves the server for inventory reads,
  and a new column is invisible until someone names it.
- **Staff review metadata stops reaching the requester**, including which staff
  member decided the request.
- **Two projections gain unit tests** that run in `npm test` with no docker.
- **Two `as "available"` casts disappear** from `items.tsx` (lines 148 and 185),
  because the views declare `ItemStatus` rather than copying the `string` that
  `InventoryItemPublic` uses. The third, on the cart row at line 92, stays: cart
  is out of scope.
- **A same-name-different-column trap is designed out** rather than documented.
  A request entry never carries both the item's and the line's `pickupBy`.

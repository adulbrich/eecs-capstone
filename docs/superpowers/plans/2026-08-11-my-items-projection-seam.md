# The `/my/items` Projection Seam Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `listMyItemsAs` return named projections instead of raw Drizzle rows, so all three non-staff inventory read paths go through `src/lib/inventory-visibility.ts` and the guarantee in `QUIRKS.md` becomes true.

**Architecture:** Two new projections, `holdItemView` and `myRequestLineView`, join `publicItemView` and `staffItemView` in the module that owns which fields leave the server. The three entry shapes stop being interchangeable: only a hold carries an item as its subject, while request and history entries carry a line plus the item's name (and, for requests, its status). `DeadlineEntry` moves with them.

**Spec:** `docs/superpowers/specs/2026-08-11-my-items-projection-seam-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **The wire format changes.** Fields leave the `/my/items` SSR payload. Every one is unrendered today, so no UI loses information.
- **No behavior change**: same rows, same ordering, same errors, same server function names.
- **No migration.**
- **No back-compat shims.** No transitional union on `DeadlineEntry` accepting both shapes; the rename lands atomically.
- **Test commands:** `ulimit -n 8192; CI=true npm test` / `npm run test:integration` (needs docker Postgres; it truncates, so `npm run db:seed:dev` afterwards if you want dev data back).
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name. Never commit to `main`.** Branch `refactor/my-items-projection-seam` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory-visibility.ts` | gains `HoldItemRow`, `HoldItemView`, `holdItemView`, `RequestLineRow`, `MyRequestLineView`, `myRequestLineView` |
| `src/lib/__tests__/inventory-visibility.test.ts` | carries-only and omits-staff-fields pairs for both new views |
| `src/lib/inventory-deadlines.ts` | `DeadlineEntry` arms reshaped, `deadlinePairOf` and `recencyOf` follow, stale comment corrected |
| `src/lib/__tests__/inventory-deadlines.test.ts` | four fixture builders updated |
| `src/test/overdue-badge.test.tsx` | two fixture literals updated |
| `src/server/_internal/inventory.ts` | `ActiveEntry` and a new `HistoryEntry`; `listMyItemsAs` projects before sorting |
| `src/routes/_authed/my/items.tsx` | reads the projected fields; two casts go |
| `src/server/__tests__/inventory.integration.test.ts` | existing assertions remapped, plus the key-set guards |
| `docs/QUIRKS.md` | the false claim corrected and recorded |

---

## Phase 1: the two projections

Additive. Nothing calls them yet, so this phase cannot break anything and the unit tests are the only proof it works.

- [ ] **Step 1: write the failing unit tests.** In `src/lib/__tests__/inventory-visibility.test.ts`, add a line-row fixture beside the existing `row` and `categories` consts, then two describe blocks. Import `holdItemView` and `myRequestLineView` at the top.

```ts
const lineRow = {
  id: "line-1",
  requestId: "req-1",
  itemId: "i-1",
  status: "approved",
  reviewedBy: "u-staff",
  reviewedAt: new Date("2026-02-02"),
  reviewComment: "Approved for CS 461",
  pickupBy: new Date("2026-02-10"),
  dueAt: new Date("2026-03-01"),
  closedAt: null,
  closedBy: null,
  closedReason: null,
  createdAt: new Date("2026-02-01"),
  updatedAt: new Date("2026-02-02"),
};

describe("holdItemView", () => {
  const view = holdItemView(row);

  it("carries only what a holder's own page reads", () => {
    expect(view).toEqual({
      id: "i-1",
      name: "Raspberry Pi 5",
      status: "checked_out",
      pickupBy: null,
      dueAt: new Date("2026-03-01"),
      updatedAt: new Date("2026-02-01"),
    });
  });

  it("omits every staff-only field", () => {
    for (const key of [
      "serial",
      "label",
      "location",
      "notes",
      "currentHolderId",
      "currentHolderEmail",
      "currentHolderName",
      "currentHolderLabel",
      "currentHolderProgram",
      "currentRequestItemId",
      "description",
      "imageUrl",
      "createdAt",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
  });
});

describe("myRequestLineView", () => {
  const view = myRequestLineView(lineRow);

  it("carries only what a requester's own page reads", () => {
    expect(view).toEqual({
      id: "line-1",
      status: "approved",
      pickupBy: new Date("2026-02-10"),
      dueAt: new Date("2026-03-01"),
      createdAt: new Date("2026-02-01"),
      closedReason: null,
    });
  });

  it("omits the staff review columns", () => {
    // reviewComment is a duplicate of closedReason, which the page does render.
    for (const key of [
      "reviewedBy",
      "reviewedAt",
      "reviewComment",
      "closedBy",
      "closedAt",
      "requestId",
      "itemId",
      "updatedAt",
    ]) {
      expect(view).not.toHaveProperty(key);
    }
  });
});
```

- [ ] **Step 2: pin the fixture's status to the enum.** The shared `row` const infers `status: string`, which will not satisfy `HoldItemRow`. Change line 76 to `status: "checked_out" as const,`. `publicItemView` and `staffItemView` still accept it, because a string literal is assignable to `string`.

- [ ] **Step 3: run the tests and confirm they fail.** Run: `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/inventory-visibility.test.ts`. Expected: failures naming `holdItemView` and `myRequestLineView` as not exported.

- [ ] **Step 4: add the types.** In `src/lib/inventory-visibility.ts`, after `InventoryItemStaff` (around line 146):

```ts
/**
 * The `/my/items` views.
 *
 * A third read path for the same table, and the reason these exist rather than
 * reusing `publicItemView`: that one requires a categories argument fed by a
 * correlated subquery this path does not run, and `/my/items` renders neither
 * categories nor a description.
 *
 * `status` is the enum here rather than `string`, so the page does not cast it
 * back to a union it already had.
 */
export type HoldItemRow = Omit<InventoryItemRow, "status"> & {
  status: ItemStatus;
};

export interface HoldItemView {
  dueAt: Date | null;
  id: string;
  name: string;
  pickupBy: Date | null;
  status: ItemStatus;
  updatedAt: Date;
}

/** Every column on a request line, so the narrowing below is visible. */
export interface RequestLineRow {
  closedAt: Date | null;
  closedBy: string | null;
  closedReason: string | null;
  createdAt: Date;
  dueAt: Date | null;
  id: string;
  itemId: string;
  pickupBy: Date | null;
  requestId: string;
  reviewComment: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  status: string;
  updatedAt: Date;
}

export interface MyRequestLineView {
  closedReason: string | null;
  createdAt: Date;
  dueAt: Date | null;
  id: string;
  pickupBy: Date | null;
  status: string;
}
```

- [ ] **Step 5: add the two functions**, after `staffItemView`:

```ts
/**
 * What someone holding an item may see about it on their own page.
 *
 * `updatedAt` is here because it is the tie-break in `compareByDeadline`, not
 * because the page renders it.
 */
export function holdItemView(row: HoldItemRow): HoldItemView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pickupBy: row.currentPickupBy,
    dueAt: row.currentDueAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * What the requester may see about their own request line.
 *
 * The review columns stay behind: `reviewedBy` names the staff member who
 * decided, and `reviewComment` is the same string as `closedReason`, which is
 * the one the page renders.
 */
export function myRequestLineView(row: RequestLineRow): MyRequestLineView {
  return {
    id: row.id,
    status: row.status,
    pickupBy: row.pickupBy,
    dueAt: row.dueAt,
    createdAt: row.createdAt,
    closedReason: row.closedReason,
  };
}
```

- [ ] **Step 6: run the tests and confirm they pass.** Run: `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/inventory-visibility.test.ts`. Expected: PASS.

- [ ] **Step 7: full gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`. All green.

- [ ] **Step 8: commit.**

```bash
git add src/lib/inventory-visibility.ts src/lib/__tests__/inventory-visibility.test.ts
git commit -m "feat(inventory): add the my-items projections"
```

---

## Phase 2: reshape the read path

Atomic by necessity. `DeadlineEntry` describes what `listMyItemsAs` returns and what the badge consumes, so the module, the server, the route and the two fixture suites move together or typecheck fails. Do not add a transitional union.

- [ ] **Step 1: reshape `DeadlineEntry`** in `src/lib/inventory-deadlines.ts:67-81`, replacing both arms:

```ts
export type DeadlineEntry =
  | {
      item: {
        dueAt: Date | null;
        pickupBy: Date | null;
        status: string;
        updatedAt: Date;
      };
      kind: "hold";
    }
  | {
      itemStatus: string;
      kind: "request";
      line: { createdAt: Date; dueAt: Date | null; pickupBy: Date | null };
    };
```

- [ ] **Step 2: correct the type's comment** at `src/lib/inventory-deadlines.ts:59-66`. It currently says the type avoids importing `ActiveEntry` because that type "carries Drizzle row types and would not cross to the client." That stops being true this phase. Replace the last sentence with: `Typed structurally rather than importing the server's ActiveEntry: this module needs four fields and says so, which keeps it usable by anything that has them.`

- [ ] **Step 3: follow through in `deadlinePairOf` and `recencyOf`** (`:90-103` and `:116-118`):

```ts
export function deadlinePairOf(entry: DeadlineEntry): DeadlinePair {
  if (entry.kind === "hold") {
    return {
      status: entry.item.status,
      pickupBy: entry.item.pickupBy,
      dueAt: entry.item.dueAt,
    };
  }
  return {
    status: entry.itemStatus,
    pickupBy: entry.line.pickupBy,
    dueAt: entry.line.dueAt,
  };
}
```

`recencyOf` needs no edit: it reads `entry.item.updatedAt` and `entry.line.createdAt`, both of which survive.

- [ ] **Step 4: update the deadline fixtures.** In `src/lib/__tests__/inventory-deadlines.test.ts`, the builders at `:77-86`, `:88-96`, `:135-143` and `:144-152` construct `currentPickupBy` / `currentDueAt` on the item and `item: { status }` on the request arm. Rename the hold keys to `pickupBy` / `dueAt`, and replace the request arm's `item: { status: s }` with `itemStatus: s`. The `deadlinePairOf` output assertions at `:100-115` assert on `DeadlinePair`, whose keys do not change, so they stay. Check the `as never` escape at `:129` still compiles.

- [ ] **Step 5: update the badge fixtures.** In `src/test/overdue-badge.test.tsx`, the `hold()` builder at `:12-26` and the request literal at `:59-63` take the same two edits.

- [ ] **Step 6: run the pure suites and confirm they pass.** Run: `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/inventory-deadlines.test.ts src/test/overdue-badge.test.tsx`. Expected: PASS. Typecheck will still fail until Step 8, which is expected at this point.

- [ ] **Step 7: reshape the entry types** in `src/server/_internal/inventory.ts:1013-1021`. Import `holdItemView`, `myRequestLineView`, `type HoldItemView`, `type MyRequestLineView` and `type ItemStatus` from `~/lib/inventory-visibility` alongside the existing imports.

```ts
/**
 * An entry in the Active tab. Only a hold carries the item as its subject,
 * because only a hold has no request line. A request carries its line plus the
 * item's name and status: its deadlines live on the line, and letting it carry
 * both would put two different `pickupBy` values on one object.
 */
export type ActiveEntry =
  | { item: HoldItemView; kind: "hold" }
  | {
      collectedBy: CollectedBy | null;
      itemName: string;
      itemStatus: ItemStatus;
      kind: "request";
      line: MyRequestLineView;
    };

export interface HistoryEntry {
  collectedBy: CollectedBy | null;
  itemName: string;
  line: MyRequestLineView;
}
```

- [ ] **Step 8: project before sorting** in `listMyItemsAs` (`:1173-1191`), replacing the `active` construction and the return:

```ts
  const active: ActiveEntry[] = [
    ...activeLines.map(
      (row): ActiveEntry => ({
        kind: "request",
        collectedBy: collectedByForViewer(row.line.id),
        itemName: row.item.name,
        itemStatus: row.item.status,
        line: myRequestLineView(row.line),
      })
    ),
    ...holds.map(
      (row): ActiveEntry => ({ kind: "hold", item: holdItemView(row.item) })
    ),
  ].sort(compareByDeadline);

  return {
    cart,
    active,
    history: history.map(
      (row): HistoryEntry => ({
        itemName: row.item.name,
        line: myRequestLineView(row.line),
        collectedBy: collectedByForViewer(row.line.id),
      })
    ),
  };
```

The three `db.select` calls are not touched: the projection is applied in JS, per the spec.

- [ ] **Step 9: update the route.** In `src/routes/_authed/my/items.tsx`:
  - Hold arm: `entry.item.currentPickupBy` becomes `entry.item.pickupBy` at `:151` and `:156`; `entry.item.currentDueAt` becomes `entry.item.dueAt` at `:160` and `:163`. Delete the ` as "available"` cast at `:148`.
  - Request arm: replace `const { line, item } = entry;` at `:174` with `const { line, itemName, itemStatus } = entry;`. Then `item.status` becomes `itemStatus` at `:177` and `:185`, `item.name` becomes `itemName` at `:184`, and the ` as "available"` cast at `:185` goes.
  - History: the destructure at `:229` becomes `({ line, itemName, collectedBy })` and `item.name` at `:234` becomes `itemName`.
  - Leave the cart cast at `:92` alone. Cart is out of scope.

- [ ] **Step 10: remap the integration assertions that reference `entry.item` on a request entry.** A request entry no longer has an item object, and this is the largest single source of breakage. Visit each:
  - `:1827` and `:1951-1952` assert `active[0].item.id` after asserting `kind` is `"hold"`. These still compile once TypeScript narrows on `kind`; confirm the `expect(active[0].kind).toBe("hold")` line precedes them, and if narrowing does not apply, wrap in `if (active[0].kind === "hold")`.
  - `:2039-2044` and `:2088-2091` map `entry.item.name` over a mixed list. Replace with `active.map((entry) => (entry.kind === "hold" ? entry.item.name : entry.itemName))`.
  - `:2168` and `:2175` filter with `(e) => e.item.id === item.id`. Each list belongs to one viewer and holds that one item, so filter on the discriminant instead: `active.filter((e) => e.kind === "request")` and `active.filter((e) => e.kind === "hold")` respectively, keeping the `kind` assertions that follow.
  - `:2796` and `:2828` do `active.find((e) => e.item.id === item.id)` then narrow to `"request"`. Replace the predicate with `(e) => e.kind === "request"`.

- [ ] **Step 11: full gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, then `npm run test:integration` with docker Postgres up. All green. If the integration run surfaces another `.item` reference the list above missed, fix it and note it in the commit.

- [ ] **Step 12: commit.**

```bash
git add src/lib/inventory-deadlines.ts src/lib/__tests__/inventory-deadlines.test.ts \
  src/test/overdue-badge.test.tsx src/server/_internal/inventory.ts \
  src/routes/_authed/my/items.tsx src/server/__tests__/inventory.integration.test.ts
git commit -m "refactor(inventory): read /my/items through the projection seam"
```

---

## Phase 3: the assertion that guards the seam

Phase 2 fixes today's leak. This is what fails when a fourth read path is written the same way.

- [ ] **Step 1: add the key-set assertions** to `src/server/__tests__/inventory.integration.test.ts`, in the `listMyItemsAs` area. Use an existing test that already produces one hold entry and one request entry, or add a case that does.

```ts
it("names every field it returns, so a new column cannot ride the payload", async () => {
  // The projection cannot widen on its own. What broke before was a
  // db.select() above it, which is what this assertion catches.
  const { active } = await listMyItemsAs(requester);

  const hold = active.find((e) => e.kind === "hold");
  expect(hold).toBeDefined();
  if (hold?.kind === "hold") {
    expect(Object.keys(hold.item).sort()).toEqual([
      "dueAt",
      "id",
      "name",
      "pickupBy",
      "status",
      "updatedAt",
    ]);
  }

  const request = active.find((e) => e.kind === "request");
  expect(request).toBeDefined();
  if (request?.kind === "request") {
    expect(Object.keys(request).sort()).toEqual([
      "collectedBy",
      "itemName",
      "itemStatus",
      "kind",
      "line",
    ]);
    expect(Object.keys(request.line).sort()).toEqual([
      "closedReason",
      "createdAt",
      "dueAt",
      "id",
      "pickupBy",
      "status",
    ]);
  }
});
```

- [ ] **Step 2: confirm it discriminates.** Temporarily add `serial: "SN-1"` to the object `holdItemView` returns, run the test, and confirm it fails. Revert the temporary edit. A guard that passes whatever you do is not a guard.

- [ ] **Step 3: run it.** `npm run test:integration`. Expected: PASS.

- [ ] **Step 4: commit.**

```bash
git add src/server/__tests__/inventory.integration.test.ts
git commit -m "test(inventory): assert the my-items payload names its fields"
```

---

## Phase 4: correct the documentation

- [ ] **Step 1: fix the false claim.** In `docs/QUIRKS.md`, the Projects section entry "Staff-only columns leak unless stripped in `stripPrivateFields`" (around line 670) asserts inventory has no such hazard. Rewrite that paragraph so it says three read paths exist and all three go through the module, and record that the claim was false: the `/my/items` path shipped `serial`, `notes`, `label` and `location` plus the request line's `reviewedBy`, `reviewedAt` and `reviewComment` for months while this entry said it could not happen. Follow the tone of `b078f24 docs(quirks): correct the overdue badge claim` and of the deadlines entry's "An earlier version of this entry claimed those badges already existed; they did not."

- [ ] **Step 2: name the new modules** in the Inventory section, beside the `canSeeRetired` entry: `holdItemView` and `myRequestLineView` are the `/my/items` projections, a request entry carries `itemName` and `itemStatus` rather than an item view so that one object never carries two different `pickupBy` values, and history carries `itemName` only because the item's current state does not describe a closed line.

- [ ] **Step 3: commit.**

```bash
git add docs/QUIRKS.md
git commit -m "docs(quirks): correct the inventory payload claim"
```

---

## Phase 5: verify and open the PR

- [ ] **Step 1:** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`. All green.
- [ ] **Step 2:** `/my/items` changes, so run `npm run test:accessibility` too. Seed first if the integration run truncated: `npm run db:seed:dev`.
- [ ] **Step 3:** Push the branch, open the PR, wait for `verify` to go green.

## Risks

| Risk | Mitigation |
| --- | --- |
| The `DeadlineEntry` reshape ripples further than the four listed files | Phase 2 Step 11 runs typecheck across the repo; anything missed is a compile error, not a silent bug |
| An integration assertion reaches `.item` on a request entry and was missed in Step 10 | Same: it is a typecheck failure. Step 11 says to fix and note rather than work around |
| The key-set assertion passes vacuously | Phase 3 Step 2 makes it fail on purpose before trusting it |
| `searchVector` turns out not to be on the payload, making the spec's table wrong | Checked and confirmed: the emitted SQL names `"search_vector"` and the row carries it, `generatedAlwaysAs` notwithstanding. The spec's hedge is now a statement |
| Sorting after projecting changes the order | `compareByDeadline` reads the same four values before and after, only under new names. The existing ordering tests at `inventory.integration.test.ts:1981-2092` cover it |

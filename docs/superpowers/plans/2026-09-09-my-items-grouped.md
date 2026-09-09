# My Items Grouped Table Implementation Plan

> **For agentic workers:** Implement inline, task by task, test first within each step, with the code review loop at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three tabs on `/my/items` with one grouped table (borrow list, one group per request, staff holds) and an `open | closed | all` filter, reusing the line sheet from #283 with no actor named.

**Architecture:** `listMyItemsAs` returns one flat array of rows in display order, each row carrying its group identity (`kind: "cart" | "request" | "hold"`), so the page hands it straight to `AdminDataTable`'s `group` prop. Nothing is sortable or hideable, so the sorted model equals the input and the grouped view cannot be sorted away from under the Submit button. The filter is derived by a pure `src/lib/my-items-filter.ts`. Submit lives on the borrow-list header and opens a small dialog carrying the note.

**Tech Stack:** as #283, plus the `Select` for the filter.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-requests-and-inventory-ux-design.md`, "The two pages", `/my/items`. Issue #284. Depends on #282 and #283.

## Global Constraints

- **Prose contains no emdashes and no emojis.**
- **Every column is `enableHiding: false` and `enableSorting: false`.** No hidden rank column. `defaultSort` is `{ desc: false, id: "item" }` and inert.
- **`sort` and `dir` leave the route's search schema.** `filter` replaces `tab`; no redirect shim; every writer of `?tab=` is rewritten.
- **`MyRequestLineView` gains `reviewedAt` and `closedAt` and nothing else.** No `reviewedBy`, `closedBy`, `reviewComment`. Key-set assertions are updated, not dropped.
- **Do not name a status that does not exist yet.** Open is cart, `pending`, `approved`, a hold. Closed is `rejected`, `cancelled`, `returned`. #80 extends it.
- **A request row carries `itemName` and `itemStatus` flat**, never an item view (QUIRKS, "/my/items has its own two projections").
- **Test commands** as #283, plus `npm run test:e2e -- --grep inventory` for the three inventory specs (docker up, seed, chromium).
- **Branch `feat/my-items-grouped` off `feat/request-queue-grouped`.**

## Seams under test

| Seam | Kind |
| --- | --- |
| `myRequestLineView` with the two dates | unit |
| `isOpenRow`, `matchesMyItemsFilter` | unit |
| `SubmitBorrowListDialog` | unit, jsdom, server fn mocked |
| `NeedsAttention` link | unit (existing test rewritten) |
| `listMyItemsAs` order, group identity, exact key sets | integration (existing describes rewritten) |
| notification links | unit and integration (existing assertions rewritten) |
| `/my/items` each filter, the sheet, the submit dialog | accessibility suite (user tests rewritten) |
| borrow list to request, cancel, overdue | e2e (three specs rewritten) |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory-visibility.ts` | `MyRequestLineView` gains `closedAt`, `reviewedAt` |
| `src/lib/my-items-filter.ts`, `src/lib/__tests__/my-items-filter.test.ts` | `MyItemsFilter`, `isOpenRow`, `matchesMyItemsFilter` |
| `src/server/_internal/inventory-holdings.ts` | `MyItemsRow`, `listMyItemsAs` returning `MyItemsRow[]` |
| `src/components/submit-borrow-list-dialog.tsx`, `src/test/submit-borrow-list-dialog.test.tsx` | Submit on the header, note in a dialog, calls `submitCart` |
| `src/components/borrow-list-panel.tsx`, `src/test/borrow-list-panel.test.tsx` | deleted |
| `src/routes/_authed/my/items.tsx` | search schema, columns, groups, filter, sheet |
| `src/lib/inventory-notifications.ts`, `src/components/borrow-list-button.tsx`, `src/components/user-menu.tsx`, `src/components/my-items-attention.tsx` | `?filter=` links |
| `src/lib/__tests__/inventory-notifications.test.ts`, `src/test/my-items-attention.test.tsx`, `src/server/__tests__/inventory.integration.test.ts` | asserted links, key sets, order |
| `src/test/e2e/locators.ts`, `inventory.e2e.test.ts`, `inventory-requests.e2e.test.ts`, `inventory-overdue.e2e.test.ts` | `entryFor` scoped to the table; `goto` calls; submit through the dialog |
| `src/test/a11y/user.a11y.test.ts` | the three `/my/items` scans over filters instead of tabs |
| `docs/QUIRKS.md`, `docs/UI-CONVENTIONS.md` | sorting disabled on purpose; the page-width paragraph |

## Interfaces

```ts
// inventory-holdings.ts
export type MyItemsRow =
  | { itemId: string; itemName: string; itemStatus: ItemStatus; kind: "cart" }
  | {
      collectedBy: CollectedBy | null;
      itemName: string;
      itemStatus: ItemStatus;
      kind: "request";
      line: MyRequestLineView;
      note: string | null;
      requestId: string;
      requestedAt: Date;
    }
  | { item: HoldItemView; kind: "hold" };
export async function listMyItemsAs(viewer: Viewer): Promise<MyItemsRow[]>;
// Order: cart rows (newest added first), then requests newest first with lines
// oldest first inside each, then holds by compareByDeadline. Closed lines are
// limited to the 50 most recently updated, as history was.

// my-items-filter.ts
export type MyItemsFilter = "all" | "closed" | "open";
export const MY_ITEMS_FILTERS: readonly MyItemsFilter[]; // ["open", "closed", "all"]
export function isOpenRow(row: { kind: "cart" } | { kind: "hold" } | { kind: "request"; line: { status: string } }): boolean;
export function matchesMyItemsFilter(row, filter: MyItemsFilter): boolean;

// submit-borrow-list-dialog.tsx
export function SubmitBorrowListDialog(props: { count: number; onSubmitted: (result: { skipped: { itemId: string }[]; submitted: string[] }) => void }): JSX.Element;
// Button "Submit" opens a Dialog: "Note for staff (optional)" textarea, "Submit request".
```

Group keys: `"cart"`, `` `request:${requestId}` ``, `"holds"`. Headers: "Not submitted yet" with the count and the Submit dialog as the action; "Requested on <date>" plus the note; "Assigned to you by staff". Row actions: Remove on a cart row, Cancel on a request row under today's `canCancel`, Details on request and hold rows. Columns: Item (cardHeader; collector as a subline), State, Deadline, Note from staff, Actions. `filtered` is `rows.length > 0 && filter !== "all"`, so a person with nothing at all sees the empty message and a person whose filter matched nothing keeps the filter control.

---

### Task 1: `MyRequestLineView` dates and the filter module
- [ ] Unit tests: `myRequestLineView` equals the six fields plus `reviewedAt` and `closedAt`; `isOpenRow` for each kind and status; `matchesMyItemsFilter` for the three filters. Run, fail. Implement. Pass. Commit `feat(lib): derive the my items filter, and give the requester line its two dates`.

### Task 2: `listMyItemsAs` as rows in display order
- [ ] Rewrite the integration describes that read `cart`, `active`, `history` (`my items payload names every field it returns`, `active tab ordering`, `staff-assigned holds in my items`, `listMyItemsAs collectedBy gate`, `a teammate collects`, `disjointness invariant`, and any other reader: grep `listMyItemsAs(`). Assert the order and the exact key sets per kind. Run, fail. Implement. Pass. Commit `feat(inventory): return my items as grouped rows in display order`.

### Task 3: `SubmitBorrowListDialog`
- [ ] jsdom test with `submitCart` mocked: opens, sends the note (empty becomes null), reports the result; a server error shows inside. Implement. Commit `feat(components): submit the borrow list from its group header`.

### Task 4: The route, the links, the deletions
- [ ] Rewrite `src/routes/_authed/my/items.tsx`; rewrite the four link writers; delete `borrow-list-panel.tsx` and its test; rewrite `my-items-attention.test.tsx` and `inventory-notifications.test.ts` assertions; update the integration link assertion. `npm run check`, `npm run typecheck`, `npm test`. Browser check through the a11y user session. Commit `feat(my-items): one grouped table with an open, closed, all filter`.

### Task 5: Browser suites
- [ ] `locators.ts`: `entryFor` scoped to `page.getByRole("table", { name: "My items" })`. Rewrite the three e2e specs' `goto` calls and the submit flow. Rewrite the three `/my/items` a11y tests. Run `npm run test:accessibility -- --grep "my items"`, `npm run test:accessibility:smoke`, `npm run test:e2e -- --grep inventory`. Commit `test(my-items): drive the grouped table instead of the tabs`.

### Task 6: Docs, PR, review loop
- [ ] QUIRKS Inventory: sorting disabled so the grouped view cannot be sorted away from under Submit; amend "/my/items has its own two projections". UI-CONVENTIONS page-width paragraph. PR against `feat/request-queue-grouped`; `mattpocock-skills:code-review` until clean.

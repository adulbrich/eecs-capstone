# Custom Requests Implementation Plan

> **For agentic workers:** Implement inline, task by task, test first within each step, with the code review loop at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user ask for equipment the inventory does not hold, and let staff answer it in the same queue as borrow lists, ending with real items linked to the line and reserved to whoever asked.

**Architecture:** The request envelope is reused. Two new tables hold custom lines and the items a fulfilled line produced. A pure `inventory-custom-workflow.ts` says which transition is legal and who may make it; a new `src/server/inventory-custom.ts` namespace exposes six endpoints over `*As` seams in `_internal/inventory-custom.ts`. The staff queue and `/my/items` gain a second row kind, switched on through one map keyed by `kind`. Fulfilling reserves items through `transitionItem` with notifications suppressed, then writes the one fulfill notification itself.

**Tech Stack:** as the three PRs before it, plus a Drizzle migration and TanStack Form's array mode.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-requests-and-inventory-ux-design.md`, all sections. Issue #80. Depends on #282, #283, #284 (PRs #287, #290, #291).

## Global Constraints

- **Prose contains no emdashes and no emojis.**
- **`INVENTORY_CUSTOM_LINE_STATUSES` lives in `src/lib/vocabularies.ts`** as an `as const` tuple with a `pgEnum` behind it, and nowhere else is the list written out: `vocabulary-scan` fails on a copy. The queue's union filter is built from the two tuples.
- **`approved` and `returned` do not exist for a custom line.** `pending`, `sourcing`, `fulfilled`, `rejected`, `cancelled`.
- **Write rules:** `reviewed_by`/`reviewed_at` written once, on the first staff decision, never overwritten. `closed_by`/`closed_at` written by the closing transition, staff or requester. `sourcing_note` written by sourcing and rewritable while sourcing. `outcome_note` written by the close. A rejection requires a reason.
- **Nothing on a submitted line is editable** (`name`, `reason`, `quantity`, `link`, the envelope note). No `updateCustomLineAs`.
- **Fulfill links items, never creates one.** Items locked in ascending id order, fail whole naming an item that is not `available`, reservation through `transitionItem` as an ordinary staff hold with `holderId` the requester, one notification per fulfill.
- **Nothing here is public.** A viewer who is not the requester and not staff reads nothing.
- **Every new endpoint has its line in `src/server/__tests__/access-contract.ts`.**
- **Every query joining `inventory_requests` to `inventory_request_items` is checked**, because an envelope may now hold no item line. Today: `countPendingRequests`, `listInventoryRequestsAs`, `listMyItemsAs`, the overdue scan, `deleteAccount`'s preview. Only the first three change.
- **Test commands** as #284, plus `npm run db:generate` (needs `.env.local`) and `npm run db:migrate` before the integration suite.
- **Branch `feat/custom-requests` off `feat/my-items-grouped`.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/vocabularies.ts` | `INVENTORY_CUSTOM_LINE_STATUSES`, `InventoryCustomLineStatus` |
| `src/db/schema.ts`, `drizzle/0024_*.sql` | `inventoryCustomLineStatusEnum`, `inventoryCustomLines`, `inventoryCustomLineItems` |
| `src/lib/inventory-custom-workflow.ts` + test | `CustomLineTransition`, `assertCustomLineTransition(viewer, line, to)`, `CUSTOM_LINE_OPEN_STATUSES` |
| `src/lib/inventory-visibility.ts` + test | `CustomLineRow`, `MyCustomLineView`, `StaffCustomLineView`, `myCustomLineView`, `staffCustomLineView` |
| `src/lib/inventory-notifications.ts` + test | `customLineNotification(event, line, requesterId, extra)` for the four cases; `TransitionNotice.silent` |
| `src/lib/inventory-workflow.ts` + test | `TransitionInput.silent`, staff only |
| `src/lib/inventory-timeline.ts` | unchanged; the callers pass `decidedLabel: "Sourcing"` |
| `src/lib/my-items-filter.ts` + test | `kind: "custom"` rows: `sourcing` open, `fulfilled` closed; `withParentLines(rows, filter)` keeps a linked item's line visible |
| `src/server/_internal/inventory-custom.ts` | the six `*As` seams and their `*ForCurrentUser` wrappers |
| `src/server/inventory-custom.ts` | the six `createServerFn` endpoints |
| `src/server/_internal/inventory-transitions.ts` | honour `silent` |
| `src/server/_internal/inventory-holdings.ts` | queue rows and my-items rows gain custom lines and linked items |
| `src/server/_internal/admin.ts` | `countPendingRequests` counts envelopes with any pending line of either kind |
| `src/server/__tests__/access-contract.ts`, `inventory-custom.integration.test.ts` | contract lines; lifecycle, fulfill, cross-user refusal, tile count |
| `src/routes/_authed/inventory/request.tsx` | the form |
| `src/routes/inventory/index.tsx` | the button beside `BorrowListButton`, the empty-state link carrying `q` |
| `src/routes/_authed/inventory/new.tsx` | `name`, `description`, `from` search params for the prefill and the return |
| `src/components/custom-line-actions.tsx`, `fulfill-custom-line-dialog.tsx`, `sourcing-note-dialog.tsx` + tests | staff actions per custom line |
| `src/routes/_authed/admin/inventory/requests.tsx` | the second row kind through `KIND` map; union status filter |
| `src/routes/_authed/my/items.tsx` | custom rows, nested linked items, cancel |
| `scripts/seed-dev.ts` | one custom request, sourcing, so both pages show the kind |
| `CONTEXT.md`, `docs/QUIRKS.md`, `docs/adr/0017-*.md`, `0018-*.md`, `PRD.md` | the docs the issue lists |

## Interfaces

```ts
// vocabularies.ts
export const INVENTORY_CUSTOM_LINE_STATUSES = ["pending", "sourcing", "fulfilled", "rejected", "cancelled"] as const;
export type InventoryCustomLineStatus = (typeof INVENTORY_CUSTOM_LINE_STATUSES)[number];

// inventory-custom-workflow.ts
export type CustomLineTransition = "cancel" | "fulfill" | "reject" | "source";
export const CUSTOM_LINE_TARGET: Record<CustomLineTransition, InventoryCustomLineStatus>;
/** Throws unless `from` allows `transition` and the viewer may make it: staff for source, fulfill, reject; the requester for cancel. */
export function assertCustomLineTransition(viewer: Viewer, line: { requesterId: string; status: string }, transition: CustomLineTransition): asserts viewer is NonNullable<Viewer>;
export function isOpenCustomLine(status: string): boolean; // pending | sourcing

// inventory-visibility.ts
export interface CustomLineRow { closedAt, closedBy, createdAt, id, link, name, outcomeNote, quantity, reason, requestId, reviewedAt, reviewedBy, sourcingNote, status }
export interface MyCustomLineView { closedAt, createdAt, id, link, name, outcomeNote, quantity, reason, sourcingNote, status }
export type StaffCustomLineView = MyCustomLineView & { reviewedAt, reviewedBy, closedBy };

// server seams (inventory-custom.ts)
submitCustomRequestAs(viewer, { lines: { name, reason, quantity, link }[]; note: string | null }): Promise<{ requestId: string }>
startSourcingCustomLineAs(viewer, { customLineId, sourcingNote: string | null })
updateSourcingNoteAs(viewer, { customLineId, sourcingNote: string })
rejectCustomLineAs(viewer, { customLineId, outcomeNote: string })
fulfillCustomLineAs(viewer, { customLineId, itemIds: string[]; outcomeNote: string | null; reserve: boolean; pickupBy: Date | null })
cancelCustomLineAs(viewer, { customLineId, outcomeNote: string | null })

// queue row (inventory-holdings.ts)
type QueueRow =
  | { kind: "item"; ...today's row }
  | { kind: "custom"; line: StaffCustomLineView; items: { id: string; name: string; status: ItemStatus }[]; requestId; requester; requestedAt; note; reviewer; closer };

// my items row
MyItemsRow gains
  | { kind: "custom"; line: MyCustomLineView; note; requestId; requestedAt }
and the hold arm gains `viaCustomLineId: string | null`, placed directly after its line.
```

`transitionItem` gains `silent?: boolean` on `TransitionInput`: `assertAuthorized` refuses it under any self-service authority, and `notificationFor` returns null when it is set. Fulfill is the one caller.

---

### Task 1: Vocabulary, schema, migration
- [ ] Tuple and type in `vocabularies.ts`; `pgEnum`, the two tables, three indexes and the `RESTRICT` join FK in `schema.ts`; `npm run db:generate`; rename the migration to `0024_custom_requests.sql`; `npm run db:migrate`; `npm test` (vocabulary scan passes). Commit `feat(db): custom request lines and the items that fulfilled them`.

### Task 2: The workflow module
- [ ] Unit tests: every legal transition from the spec's table passes, every other pair throws; staff-only transitions refuse the requester; cancel refuses staff who are not the requester and refuses a non-open line; `isOpenCustomLine`. Implement. Commit `feat(lib): custom line transitions and who may make them`.

### Task 3: Visibility, notifications, filter, silent transitions
- [ ] Visibility: two projections with exact-key unit tests; the requester view omits `reviewedBy`, `closedBy`, `reviewedAt`. Notifications: four cases, each carrying the note verbatim when non-empty, one row; links `/my/items?filter=open` for sourcing and a rewritten note, `/my/items?filter=open` for fulfilled (the reserved items are open), `/my/items?filter=closed` for rejected. `TransitionNotice.silent` returns null; `assertAuthorized` refuses `silent` with an authority. Filter: `sourcing` open, `fulfilled` closed, and `withParentLines`. Commit `feat(lib): custom line projections, notifications and the silent transition`.

### Task 4: Server seams and endpoints
- [ ] Integration tests in a new `inventory-custom.integration.test.ts`: submit creates the envelope and lines, no item lines; a non-requester reading through `listMyItemsAs` sees nothing and the queue refuses a student; pending to sourcing writes `reviewedBy` once and notifies; a rewritten note notifies and leaves `reviewedBy`; sourcing to fulfilled links two items, reserves both to the requester with `pickupBy`, writes `closedBy`, leaves `reviewedBy` from sourcing, and inserts exactly one notification for the fulfill and none for the reservations; pending straight to fulfilled with `reserve: false` links and reserves nothing; a fulfill naming an item that is `checked_out` applies nothing and names it; rejecting without a reason is refused; a rejection from sourcing works; the requester cancels while sourcing and cannot after; `countPendingRequests` counts an envelope with only pending custom lines. Implement `_internal/inventory-custom.ts` (items locked ascending inside the transaction, `transitionItem(..., { silent: true }, tx)` per item), `inventory-custom.ts` endpoints with zod schemas (`quantity: z.number().int().positive()`, `lines` min 1 max 20), the six contract lines, `countPendingRequests` over a union. Commit `feat(inventory): custom requests, from submit to fulfil`.

### Task 5: Reads
- [ ] `listInventoryRequestsAs` returns both kinds under one status filter (a status only one kind has selects that kind), search matching a custom line's name; `listMyItemsAs` returns custom lines under their request and files a hold with a join row after its line with `viaCustomLineId`. Integration tests for both, and the key-set test extended. Commit `feat(inventory): custom lines on the queue and on my items`.

### Task 6: The form and its entry points
- [ ] `/inventory/request`: TanStack Form, array of line cards (name, reason, quantity default 1, link), add and remove, one note; `?q=` seeds the first card's name; success navigates to `/my/items` with a toast. `/inventory` gains "Request something else" beside `BorrowListButton` under the same sign-in gate, and the empty state offers the same link carrying `q`. `/inventory/new` takes `name`, `description` and `from` and returns to the queue when `from` is `requests`. Unit test the form's schema. Commit `feat(inventory): a form to ask for equipment we do not hold`.

### Task 7: The queue
- [ ] `KIND` map keyed by `"item" | "custom"`: `badge`, `groupAction`, `rowActions`, `statuses`. Custom rows: name with quantity, `Custom` badge on the header, `CustomLineActions` (Start sourcing with an optional note, Fulfill dialog with an item picker over `listAdminInventory` filtered to available plus the reserve checkbox and a pickup date, Reject with a reason, Update note while sourcing, a "Create item from this line" link to `/inventory/new?name=...&from=requests`), `Start sourcing all` on the header. Union status filter. Sheet: custom fields and the timeline with `decidedLabel: "Sourcing"` and both notes. jsdom tests for the two dialogs and the actions component. Commit `feat(admin): custom lines in the request queue`.

### Task 8: My items
- [ ] Custom rows under their request with a `Custom` badge, indentation on a linked item row after its line, Cancel while pending or sourcing, the sheet with the requester's timeline and both notes. Filter through `withParentLines`. Commit `feat(my-items): custom requests and the items that fulfilled them`.

### Task 9: Seed, docs, suites, PR
- [ ] Seed one custom request for Sam, one line sourcing with a note, one pending. `CONTEXT.md` terms and the Line status amendment; `docs/QUIRKS.md` lifecycle tables, envelope note, fulfill lock order; ADR-0017 envelope reuse, ADR-0018 `sourcing` not `approved` and no `returned`; `PRD.md`. Run every gate: check, typecheck, test, integration, seed, `test:accessibility -- --grep "admin inventory requests|my items"`, `test:accessibility:smoke`, `test:e2e -- --grep inventory`. PR against `feat/my-items-grouped`; review loop.

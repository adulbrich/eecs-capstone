# Grouped Request Queue Implementation Plan

> **For agentic workers:** Implement inline, task by task, test first within each step, with the code review loop at the end. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group `/admin/inventory/requests` by the request its lines arrived in, with an Approve all over the group, a `request` deep link that lands in the grouped view, and a line sheet holding a timeline built from the line's own columns.

**Architecture:** The route passes `group` (from #282, PR #287) keyed by `requestId`. A batch endpoint `approveRequestLines` wraps the existing single-line approval, iterating lines in ascending id order inside one transaction. A pure `inventory-timeline.ts` turns a line into `TimelineEvent[]`; one `LineTimeline` component draws it inside a shared `LineSheet` shell, which #284 reuses. `AdminDataTable` is not touched.

**Tech Stack:** TanStack Start server functions, Drizzle (aliased joins on `user`), TanStack Router functional `search`, shadcn `Sheet` and `Dialog`, Vitest (unit, jsdom, integration on docker Postgres), Playwright accessibility suite.

**Spec:** `docs/superpowers/specs/2026-09-09-custom-requests-and-inventory-ux-design.md`, sections "The line sheet, on both pages" and "The two pages", `/admin/inventory/requests`. Issue #283. Depends on #282.

## Global Constraints

- **Prose contains no emdashes and no emojis.**
- **`AdminDataTable` is not modified.** Everything renders through the `group` prop and a sibling `Sheet`.
- **Lock order:** `approveRequestItemAs` locks the line then the item; the batch iterates lines in ascending id order so two overlapping batches cannot deadlock. Never lock the item first.
- **The status filter stays on the request line vocabulary.** #80 widens it.
- **No new fields change audience.** The queue is staff only; reviewer and closer names are staff data joined for staff.
- **Test commands:** `ulimit -n 8192; CI=true npm test`; `ulimit -n 8192; CI=true npm run test:integration` (docker up, truncates the dev database; `npm run db:seed:dev` afterwards); `npm run test:accessibility -- --grep "admin inventory requests"` and `npm run test:accessibility:smoke` (need the seed and chromium). On the `.nvmrc` Node with the sandbox off.
- **Before every commit:** `npm run check` and `npm run typecheck`.
- **Stage files by name. Never commit to `main`.** Branch `feat/request-queue-grouped` off `feat/admin-table-grouping`; PR based on that branch, rebased onto `main` once #287 merges.

## Seams under test

| Seam | Kind |
| --- | --- |
| `lineTimeline` | unit |
| `LineTimeline`, `LineSheet` | unit, jsdom |
| `ApproveAllDialog` | unit, jsdom, server fn mocked |
| `approveRequestLinesAs`: batch, partial group, race, overlap without deadlock | integration |
| `listInventoryRequestsAs` reviewer and closer names | integration |
| The grouped queue page, sheet open and closed | accessibility suite |
| Approve and Reject per row (unchanged) | existing e2e, unchanged |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory-timeline.ts` | `TimelineEvent`, `TimelineInput`, `lineTimeline` |
| `src/lib/__tests__/inventory-timeline.test.ts` | its unit tests |
| `src/components/line-timeline.tsx` | draws `TimelineEvent[]` as an ordered list |
| `src/components/line-sheet.tsx` | the sheet shell: title, description, fields, timeline, actions slot |
| `src/components/approve-all-dialog.tsx` | the batch dialog: item list, one pickup date, calls `approveRequestLines` |
| `src/test/line-sheet.test.tsx`, `src/test/approve-all-dialog.test.tsx` | jsdom tests |
| `src/server/_internal/inventory-requests.ts` | `approveLineInTx`, `approveRequestLinesAs`, `approveRequestLinesForCurrentUser` |
| `src/server/inventory.ts` | `approveRequestLines` endpoint |
| `src/server/_internal/inventory-holdings.ts` | `listInventoryRequestsAs` gains `reviewer` and `closer` |
| `src/server/__tests__/access-contract.ts` | one line for the endpoint |
| `src/server/__tests__/inventory.integration.test.ts` | batch cases, name join |
| `src/routes/_authed/admin/inventory/requests.tsx` | `request` param, `group`, header, Requester link, Details button, sheet |
| `scripts/seed-dev.ts` | one request with two pending lines, so the queue shows a real group |
| `docs/QUIRKS.md`, `docs/UI-CONVENTIONS.md` | batch lock order; the line sheet |

---

### Task 1: `inventory-timeline.ts`

**Files:**
- Create: `src/lib/inventory-timeline.ts`, `src/lib/__tests__/inventory-timeline.test.ts`

**Interfaces (produced):**

```ts
export interface TimelineEvent {
  /** A display name for staff, null when the audience is not told who. */
  actor: string | null;
  at: Date;
  kind: "submitted" | "decided" | "closed";
  label: string;
  note: string | null;
}

export interface TimelineInput {
  closedAt: Date | null;
  closedBy?: string | null;
  /** What the close is called: Rejected, Cancelled, Returned; later Fulfilled. */
  closedLabel: string;
  closedNote: string | null;
  /** What the decision is called: Approved on a request line, Sourcing on a custom line. */
  decidedLabel: string;
  decidedNote?: string | null;
  reviewedAt: Date | null;
  reviewedBy?: string | null;
  submittedAt: Date;
}

export function lineTimeline(input: TimelineInput): TimelineEvent[];
```

Rules: `submitted` always. `decided` when `reviewedAt` is set and either `closedAt` is null or `reviewedAt` is strictly before `closedAt`; a rejection writes both at the same instant and is one event, the close. `closed` when `closedAt` is set. Actors and notes pass through, `undefined` becoming null.

- [ ] **Step 1: Failing tests** covering: pending gives one event; approved gives submitted and decided with the actor; returned gives three; rejected (same instant) gives two, the close carrying the reason and no decided; cancelled while pending gives two with no decided; actors omitted when not passed; decided note carried (the custom line case, `decidedLabel: "Sourcing"`).
- [ ] **Step 2: Run, expect module-not-found.**
- [ ] **Step 3: Implement** with the header comment matching the five sibling modules ("Pure and client-safe, like ...").
- [ ] **Step 4: Run, PASS. Check, typecheck. Commit** `feat(lib): build a request line timeline from its columns`.

---

### Task 2: `LineTimeline` and `LineSheet`

**Files:**
- Create: `src/components/line-timeline.tsx`, `src/components/line-sheet.tsx`, `src/test/line-sheet.test.tsx`

**Interfaces (produced):**

```tsx
export function LineTimeline({ events }: { events: TimelineEvent[] }): JSX.Element;
// <ol aria-label="Timeline"> with one <li> per event: label, <LocalTime value={at} />,
// "by {actor}" when set, the note in a whitespace-pre-wrap paragraph when set.

export interface LineSheetField { label: string; value: ReactNode }
export function LineSheet(props: {
  actions?: ReactNode;
  description?: string;
  events: TimelineEvent[];
  fields: LineSheetField[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}): JSX.Element;
// Sheet side="right", SheetHeader with SheetTitle and SheetDescription (Radix needs a
// title and a description or aria-describedby), a <dl> of fields, the timeline, the
// actions in SheetFooter. Scrollable body.
```

- [ ] **Step 1: Failing jsdom tests**: renders the title as the dialog's accessible name, one list item per event with the actor when present, the fields as a definition list, and the actions; renders nothing when `open` is false.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass. Commit** `feat(components): line sheet with a timeline`.

---

### Task 3: The batch approval on the server

**Files:**
- Modify: `src/server/_internal/inventory-requests.ts`, `src/server/inventory.ts`, `src/server/__tests__/access-contract.ts`
- Test: `src/server/__tests__/inventory.integration.test.ts`

**Interfaces (produced):**

```ts
// _internal/inventory-requests.ts
export async function approveRequestLinesAs(
  viewer: Viewer,
  data: { requestItemIds: string[]; pickupBy: Date | null }
): Promise<{ approved: string[] }>;
export async function approveRequestLinesForCurrentUser(data: { requestItemIds: string[]; pickupBy: Date | null });
// inventory.ts
export const approveRequestLines = createServerFn({ method: "POST" }) // schema below
```

Schema: `requestItemIds: z.array(z.string().uuid()).min(1).max(100)`, `pickupBy: z.coerce.date().nullable().default(null)`.

Implementation: extract the body of `approveRequestItemAs`'s transaction into `approveLineInTx(tx, viewer, requestItemId, pickupBy)`; the single-line seam calls it inside `db.transaction`. `approveRequestLinesAs`: `assertStaff`, dedupe and sort the ids with `[...new Set(ids)].sort()` (uuid text order, the same order Postgres compares uuids in), one `db.transaction` running `approveLineInTx` per id, all or nothing. On a non-pending line, throw naming the item: a plain select of the item name after the status check fails, on the error path only, so no extra row is locked on the happy path. Message: `"<item> is no longer pending"`.

- [ ] **Step 1: Failing integration tests** under a new `describe("approveRequestLinesAs")`: two pending lines from one cart approve together with one `pickupBy` on both lines and both items `reserved`; a request with three lines where one was rejected first approves the other two and leaves the rejected one alone (the caller passes only pending ids); a batch naming a line that was cancelled between render and click throws `"<item> is no longer pending"` and leaves the other line `pending` and its item `requested`; two batches over overlapping ids started concurrently in opposite order both settle, one approving and the other throwing "no longer pending", with no error containing `deadlock`; a non-staff viewer is refused.
- [ ] **Step 2: Run the file, expect the describe to fail** (`ulimit -n 8192; CI=true npx vitest run --config vitest.integration.config.ts src/server/__tests__/inventory.integration.test.ts -t approveRequestLinesAs`).
- [ ] **Step 3: Implement** the seam, the endpoint, and the access contract line: `"server/inventory.ts:approveRequestLines": { level: "staff", note: "Batch over approveRequestItemAs, lines iterated in ascending id order inside one transaction; any line no longer pending fails the whole batch and names the item." }`.
- [ ] **Step 4: Run, pass**, then `npm test` for the access contract test. Commit `feat(inventory): approve every pending line of a request at once`.

---

### Task 4: Reviewer and closer names on the queue rows

**Files:**
- Modify: `src/server/_internal/inventory-holdings.ts` (`listInventoryRequestsAs`)
- Test: `src/server/__tests__/inventory.integration.test.ts`, `describe("listInventoryRequestsAs")`

Two aliased joins: `const reviewer = alias(user, "reviewer"); const closer = alias(user, "closer");` from `drizzle-orm/pg-core`, left-joined on `inventoryRequestItems.reviewedBy` and `closedBy`. The row gains `reviewer: { email, name } | null` and `closer: { email, name } | null`.

- [ ] **Step 1: Failing test**: approve a line as staff A, then release it as staff B with a return; the queue row under `status: "all"` names A as reviewer and B as closer, and a pending line has both null.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass. Commit** `feat(inventory): name the reviewer and closer on the request queue`.

---

### Task 5: `ApproveAllDialog`

**Files:**
- Create: `src/components/approve-all-dialog.tsx`, `src/test/approve-all-dialog.test.tsx`

**Interfaces (produced):**

```tsx
export function ApproveAllDialog(props: {
  lines: { id: string; itemName: string; status: string }[];
  onDone: () => void;
}): JSX.Element | null;
// Renders a Button "Approve all" (size sm) that opens a Dialog listing the pending
// lines' item names, a date input "Pickup by (optional)", an error line, Confirm and
// Cancel. Renders null when no line is pending. Calls
// approveRequestLines({ data: { requestItemIds: pendingIds, pickupBy } }).
```

- [ ] **Step 1: Failing jsdom tests** with `vi.mock("#/server/inventory")`: lists only pending item names; confirm sends only the pending ids and the date; a rejected server error shows in the dialog; nothing renders when every line is decided.
- [ ] **Step 2 to 4: fail, implement, pass. Commit** `feat(components): approve all dialog over a request`.

---

### Task 6: The route

**Files:**
- Modify: `src/routes/_authed/admin/inventory/requests.tsx`

- `request: z.string().uuid().nullable().catch(null).default(null)` beside `line`; not in `loaderDeps`.
- `group`: `key: (row) => row.requestId`; `header: (rows) => <RequestGroupHeader rows={rows} highlighted={rows[0].requestId === request} />` (requester name or email, `<LocalTime value={requestedAt} />`, the note when present, "N lines"; when highlighted, the documented `bg-[var(--brand-primary-tint)]` token and `scrollIntoView` once on mount); `actions: (rows) => <ApproveAllDialog lines={...} onDone={onDone} />`.
- Requester cell wraps its content in `<Link to="/admin/inventory/requests" search={(prev) => ({ ...prev, dir: undefined, request: row.requestId, sort: undefined })}>`.
- Actions cell: a `Details` button (`variant="outline" size="sm"`) that sets `openLineId`, before `AdminRequestActions`.
- The sheet: `LineSheet` over the open row with fields Item, Requester, Status, Requested, Pickup by, Due, Collected by, Note; events from `lineTimeline` with `decidedLabel: "Approved"`, `closedLabel: statusLabel(status)`, `closedNote: line.closedReason`, `reviewedBy: reviewer name or email`, `closedBy` likewise; actions `AdminRequestActions` with an `onDone` that also closes the sheet.
- Highlight of the group header comes from `useSearch`, no table change.

- [ ] **Step 1: Implement.** Typecheck and check.
- [ ] **Step 2: Browser check** through `preview_start` with the dev seed (write `.claude/launch.json` with the sandbox off, delete it before staging): the grouped view, Approve all, sorting by Status flattening, the Requester link returning to the grouped view with the group highlighted, the sheet opening and closing.
- [ ] **Step 3: Commit** `feat(admin): group the request queue by request, with approve all and a line sheet`.

---

### Task 7: Seed one two-line request

**Files:**
- Modify: `scripts/seed-dev.ts`, the inventory flows section

Add after case 4 a borrow list of two available items for Jordan submitted as one request with one note, left pending, so the queue shows a group with two lines and the accessibility scan covers the header with an Approve all. Pick two serials the later cases do not use.

- [ ] **Step 1: Implement**, run `npm run db:seed:dev` (it skips when already seeded: reset with the integration run first or `docker compose down -v` is not needed; the flows guard checks one serial, so run the seed after the integration suite truncates).
- [ ] **Step 2: Commit** `chore(seed): one borrow list with two pending lines`.

---

### Task 8: Docs, suites, review loop

- [ ] `docs/QUIRKS.md`, Inventory: a "Batch approve iterates lines in ascending id order" entry: line-then-item is the order `approveRequestItemAs` and `lockAttachableRequestLine` take, so a fixed line order is what stops two overlapping batches deadlocking; the fulfill path in #80 locks items, a separate rule.
- [ ] `docs/UI-CONVENTIONS.md`: a "Line sheet" paragraph after the admin tables section (a `Sheet` beside the table, not a row detail; `LineSheet` and `LineTimeline`; the first use of `Sheet` outside the mobile nav), and amend the mobile nav paragraph that says the drawer is the only `Sheet`.
- [ ] Run `npm run check`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run db:seed:dev`, `npm run test:accessibility -- --grep "admin inventory requests"`, `npm run test:accessibility:smoke`.
- [ ] Push, open the PR against `feat/admin-table-grouping` with the template filled, run `mattpocock-skills:code-review` until a pass raises nothing unanswered, record the count.

## Self-review

- Spec coverage: group header contents, Approve all with one date over pending lines only, lock order, all-or-nothing, flat view on sort, Requester link clearing sort and dir, `request` param out of `loaderDeps`, the sheet as a sibling, the three-event timeline from columns, `review_comment` out of the timeline, filter and search and picker unchanged, status filter unchanged, docs. Covered by Tasks 1 to 8.
- Type consistency: `TimelineEvent`, `TimelineInput`, `lineTimeline`, `LineSheet`, `LineTimeline`, `ApproveAllDialog`, `approveRequestLinesAs`, `approveRequestLines`, `reviewer`, `closer` used identically throughout.

# Inventory Overdue Visibility Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the deadline rules one pure, tested home; show students the overdue state the notifications already tell them about; and stop a silent `catch` from hiding a broken notification path.

**Architecture:** `src/lib/inventory-deadlines.ts` owns `overdueFlags` (with an injectable clock), `deadlinePairOf` (the one place that knows which arm of the Active-tab union stores the deadline pair), and `compareByDeadline`. The server sort and the new client badge both read the normalizer, which is what stops a second copy appearing. The lazy write stays inside the read, because the no-cron laziness is a deliberate decision; only its invisibility changes.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on Postgres, React 19, shadcn/ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-11-inventory-overdue-visibility-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.**
- **`/my/items` returns the same data.** The badge derives from fields already on the payload.
- **Notification behavior does not change**: same rows, same dedupe, same idempotency. The integration suite must pass with no edits.
- **The read still cannot fail because of the write.**
- **No migration.**
- **Test commands:** `ulimit -n 8192; CI=true npm test` / `npm run test:integration` (docker Postgres; truncates, so `npm run db:seed:dev` before any accessibility run) / `npm run test:accessibility`.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name.**
- **Never commit to `main`.** Branch: `feat/inventory-overdue-visibility`.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/inventory-deadlines.ts` | **new**: `overdueFlags`, `deadlinePairOf`, `deadlineOf`, `compareByDeadline` |
| `src/lib/__tests__/inventory-deadlines.test.ts` | **new**: boundaries with a fixed clock, ordering, per-arm normalization |
| `src/components/overdue-badge.tsx` | **new**: the two labels |
| `src/server/_internal/inventory.ts` | loses `deriveDeadlineFlags`, `deadlineOf`, `recencyOf`, `byDeadline`; the swallow reports |
| `src/routes/_authed/my/items.tsx` | renders the badge in both arms |
| `src/test/overdue-badge.test.tsx` | **new** |

---

## Phase 1: the deadlines module

- [ ] Write `src/lib/__tests__/inventory-deadlines.test.ts` first, with a **fixed clock**: a `reserved` item one second before and one second after `pickupBy`; a `checked_out` item either side of `dueAt`; a `reserved` item past its `dueAt` flags nothing, because the status decides which deadline applies; null dates flag nothing.
- [ ] Cover `deadlinePairOf` for both arms, asserting the hold arm reads `currentPickupBy`/`currentDueAt` and the request arm reads the line's, with the item's status in both.
- [ ] Cover `compareByDeadline`: soonest first, no-deadline last, newest first on a tie, and the two-entries-without-deadlines case.
- [ ] Write `src/lib/inventory-deadlines.ts`. Entry types are structural, following `inventory-visibility.ts`.
- [ ] `npm test`, `check`, `typecheck` clean.
- [ ] Commit: `feat(inventory): add the deadlines module`

## Phase 2: the server reads the module

- [ ] `recordOverdueNotificationsAs` uses `overdueFlags`; delete `deriveDeadlineFlags`.
- [ ] `listMyItemsAs` sorts with `compareByDeadline`; delete `deadlineOf`, `recencyOf`, `byDeadline`.
- [ ] Integration suite green with **zero test edits**. This is the checkpoint: the notification rows and the Active tab order must be identical.
- [ ] Commit: `refactor(inventory): read deadlines through the module`

## Phase 3: overdue becomes visible

- [ ] `src/components/overdue-badge.tsx`: `Pickup overdue` on `--status-warning`, `Overdue` on `text-destructive`, nothing when neither flag is set. Badges use `rounded` per `UI-CONVENTIONS.md`.
- [ ] `src/test/overdue-badge.test.tsx`: each label renders for its case and nothing renders otherwise.
- [ ] `/my/items` renders it beside `InventoryStatusBadge` in both arms, deriving the pair through `deadlinePairOf` rather than reading the branch's fields directly.
- [ ] Verify in the browser against a genuinely overdue item, both a hold and a request.
- [ ] Accessibility suite green (seed first).
- [ ] Commit: `feat(inventory): show students when an item is overdue`

## Phase 4: the swallow reports

- [ ] The `catch` in `listMyItemsAs` records the failure rather than discarding it. Match how the codebase already reports non-fatal server-side failures; if there is no existing pattern, `console.error` with enough context to identify the viewer and the operation.
- [ ] Keep the guarantee: the read still cannot fail because of the write. A test asserts the page still returns when the notifier throws.
- [ ] Commit: `fix(inventory): stop a failed overdue write vanishing silently`

## Phase 5: documentation

- [ ] `docs/QUIRKS.md`: the badge claim is currently false. Correct it to describe what the app does, and point at the module as the one home for the rule.
- [ ] Commit: `docs(quirks): correct the overdue badge claim`

## Phase 6: verify and open the PR

- [ ] `check`, `typecheck`, `npm test`, `build`, `check:compression`, `test:integration`, `test:accessibility` all clean.
- [ ] Push, open the PR, wait for CI.

## Risks

| Risk | Mitigation |
| --- | --- |
| The sort changes order subtly | Phase 2 is a checkpoint: the integration suite covers the Active tab order and must pass with no edits |
| Notification rows change | Same checkpoint; the dedupe and idempotency cases are already covered |
| The badge disagrees with the notification | Both derive from `overdueFlags` on the same pair, so they cannot key off different rules |
| An injectable clock defaults wrong | Default is `Date.now()`, and the existing behavior is exactly that |

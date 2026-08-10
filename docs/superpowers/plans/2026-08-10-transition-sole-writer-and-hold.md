# Transition Sole Writer and Hold Module Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This plan deliberately does **not** use `superpowers:subagent-driven-development`, unlike most plans in this directory. Phase 2 is a verification checkpoint whose entire value is that the whole integration suite passes with zero test edits, and phases 3 through 5 build directly on it. Parallel agents would be producing work that cannot be verified until that checkpoint clears, so the phases are sequential by nature and there is nothing to fan out.

**Goal:** Make `transitionItem` the sole writer of inventory item status, holder columns and status history that `docs/QUIRKS.md` already claims it is, and give the hold identity rules one pure module instead of six copies spread across three tiers.

**Architecture:** Part B lands first because it has no dependencies: `src/lib/hold.ts` is a pure module holding a discriminated union (person hold, thing hold, no hold) plus the precedence rules, unit tested without docker. Part A then uses it. `transitionItem` keeps `assertStaff` as its default and gains an optional named-authority field so the two self-service callers can pass through it explicitly; it also gains an optional request-line outcome, because rejecting a pending line and releasing a reserved item both end at `available` and only the caller can tell them apart. `submitCartAs` calls the private in-transaction helper rather than the exported interface, avoiding N redundant re-locks inside one transaction.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on Postgres, React 19, shadcn/ui, Vitest (unit + integration), Zod.

**Spec:** `docs/superpowers/specs/2026-08-10-transition-sole-writer-and-hold-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Use commas, colons, or parentheses. Applies to comments, commit messages, and UI copy.
- **Additive only.** No existing `transitionItem` call site may change. The ~90 call sites in `inventory.integration.test.ts` are the only executable specification of this behavior, neither integration nor a11y suites run in CI, and there is no functional end-to-end coverage below them. Every new field on `TransitionInput` is optional and defaults to today's behavior.
- **No wire-format change.** `transitionSchema` and `InventoryItemStaff` keep their current shapes. `src/routes/_authed/admin/inventory/index.tsx:297-319` binds the five flat holder columns as CSV export keys by string.
- **No migration.** No column is added, dropped, or renamed.
- **No back-compat shims.** The app is pre-production. Delete the duplicated writes rather than deprecating them.
- **Test commands need the sandbox disabled and a raised fd limit.**
  - Unit: `ulimit -n 8192; CI=true npm test`
  - Integration: `ulimit -n 8192; CI=true npm run test:integration` (needs docker Postgres up; truncates every table in `beforeEach`, wiping dev seed data)
- **Before every commit:** `npm run check` and `npm run typecheck` in full, never per-file. `npm exec -- ultracite fix` resolves most formatting failures.
- **Never commit to `main`.** Work happens on `refactor/transition-sole-writer-and-hold`.
- **Every phase ends with a code review before the next one starts.** Run `/code-review` on the phase's diff, or `superpowers:requesting-code-review`. Findings are resolved in the same phase, not deferred. This matters more than usual here: the integration suite is the only executable specification of this behavior, it does not run in CI, and there is no end-to-end coverage beneath it.
- **Phase 2 cannot be verified without docker Postgres.** If it is not running, stop rather than proceeding to phase 3 on an unrun checkpoint.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/hold.ts` | **new**: the `Hold` union, its constructor, precedence and display rules |
| `src/lib/__tests__/hold.test.ts` | **new**: unit tests for every rule above |
| `src/server/_internal/inventory-transitions.ts` | named authority, line outcome, reject notify arm, Hold at the write path, `validateInvariants` arm deleted |
| `src/server/_internal/inventory.ts` | reject and cancel routed through `transitionItem`, `submitCartAs` on the shared helper, read paths on Hold |
| `src/components/inventory-lifecycle-panel.tsx` | `holderFields` and `formatHolderDisplay` call Hold |
| `src/routes/_authed/admin/inventory/index.tsx` | Holder column calls Hold |
| `src/server/__tests__/inventory.integration.test.ts` | new assertions only, no rewrites |
| `docs/QUIRKS.md` | the `Hold` term, the corrected sole-writer claim |

---

## Phase 1: the Hold module

- [ ] Write `src/lib/__tests__/hold.test.ts` first, covering: address with no account carries name and program; address with a resolved account drops typed name and program; label alone is legal; address and label together throws; neither throws; a supplied address beats a supplied id; a joined account's address and name beat the stored columns; stored columns are used unreconciled when no account joined; display precedence is name, then address, then label.
- [ ] Write `src/lib/hold.ts`: the three-case union, a constructor from loose nullable fields that throws on illegal combinations, a reader that reconciles a joined row, a reader that takes stored columns unreconciled, a writer that flattens back to the five columns, and a display formatter.
- [ ] Document in the module docblock that the client's debounced `lookupUserByEmail` is presentational and the transaction's lookup is authoritative, and that they can disagree while an account is being created.
- [ ] `ulimit -n 8192; CI=true npm test` green. `npm run check` and `npm run typecheck` clean.
- [ ] Commit: `feat(inventory): add the Hold module and its rules`

## Phase 2: the write path uses Hold

- [ ] In `inventory-transitions.ts`, have `resolveHolder` return a `Hold` and `transitionItemInTx` flatten it through the Hold writer instead of hand-assigning five columns in two places (the item update and the history insert).
- [ ] **Keep** the `reserved` and `checked_out` arm of `validateInvariants`. `inventory.integration.test.ts:140-157` asserts its exact wording, and it also catches `holderId` plus `holderLabel`, which the `holderId` resolution path never routes through the constructor. Add a comment recording both reasons so a later reader does not delete it as redundant.
- [ ] Comment the `holderId` branch of `resolveHold` to say it bypasses the constructor deliberately, that `approveRequestItemAs` is its only caller, and that the caller passes no label.
- [ ] No interface change in this phase. Run `ulimit -n 8192; CI=true npm run test:integration` and confirm green with zero test edits. This is the checkpoint that proves the union is behavior-preserving.
- [ ] Commit: `refactor(inventory): write holds through the Hold module`

## Phase 3: named authority and line outcome

- [ ] Add an optional authority field to `TransitionInput` accepting only `"self_cancel"` and `"self_request"`. Absent means staff and runs `assertStaff` exactly as today. Reject any other value.
- [ ] Add an optional request-line outcome to `TransitionInput`. Absent means `closeRequestItemOnRelease` derives `returned` or `cancelled` as it does today. Present means the caller names it, and `rejected` additionally writes `reviewComment`, `reviewedBy` and `reviewedAt`.
- [ ] Add the reject arm to `maybeNotify`, emitting `inventory_request_rejected` with the review comment as the message. No migration: `notifications.type` is `text()`.
- [ ] Change `maybeNotify` to never notify a recipient who is the actor. This is what makes cancel's silence derived rather than special-cased.
- [ ] Integration tests: add cases for each new field. Do not edit existing cases. Confirm the `Forbidden` test at line 1462 still passes untouched.
- [ ] Commit: `feat(inventory): let transitionItem carry authority and line outcome`

## Phase 4: route the three bypasses

- [ ] `rejectRequestItemAs` calls `transitionItem` with the `rejected` outcome and its review comment, deleting its inline nine-column reset, its history insert and its notification insert. Its own `assertStaff` and pending-line guard stay where they are.
- [ ] `cancelRequestItemAs` calls `transitionItem` with `"self_cancel"` and the `cancelled` outcome, deleting its inline reset and history insert. Its ownership check and its "cannot cancel after checkout" guard stay where they are.
- [ ] `submitCartAs` calls the private in-transaction helper directly with `"self_request"`, deleting its inline per-item write and history insert. It keeps its own lock-first phase; the helper must not re-lock.
- [ ] Verify by grep that `.update(inventoryItems)` setting `status` and `insert(inventoryItemStatusHistory)` now appear in exactly one production location.
- [ ] `ulimit -n 8192; CI=true npm run test:integration` green with no existing case edited.
- [ ] Commit: `refactor(inventory): make transitionItem the only status writer`

## Phase 5: read paths and client

- [ ] Replace `holderEmailOf`, `holderNameOf`, `joinedHolderIdentity` and `storedHolderIdentity` in `inventory.ts` with calls into the Hold module. `fullForStaff` keeps returning five flat fields.
- [ ] `holderFields` in `inventory-lifecycle-panel.tsx` calls the Hold constructor; keep the client-side normalization, since the dialog needs the answer locally to show or hide the Name and Program inputs.
- [ ] `formatHolderDisplay` in `inventory-lifecycle-panel.tsx` and the Holder column at `src/routes/_authed/admin/inventory/index.tsx:161` both call the Hold display formatter. This removes the sixth and seventh copies of the precedence rule.
- [ ] `ulimit -n 8192; CI=true npm test` and `npm run test:integration` green.
- [ ] Commit: `refactor(inventory): read holds through the Hold module`

## Phase 6: documentation

- [ ] `docs/QUIRKS.md`, Inventory section: add `Hold` as the domain term for the union, pointing at `src/lib/hold.ts`. This repo keeps domain rules in QUIRKS rather than a separate glossary file, per `AGENTS.md`.
- [ ] `docs/QUIRKS.md`: correct the `transitionItem` is the only writer entry. It currently grants reject and cancel an explicit exemption that no longer exists, and does not mention `submitCartAs` bypassing at all.
- [ ] Note in the same entry that the staff gate is default-deny with two named authorities, and that `transitionInventoryItem` relies on it rather than carrying a guard of its own.
- [ ] Commit: `docs(quirks): record the Hold module and the corrected sole-writer rule`

## Phase 7: verify and open the PR

- [ ] `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build` all clean.
- [ ] `ulimit -n 8192; CI=true npm run test:integration` green (needs docker Postgres up).
- [ ] Push the branch and open a PR. Let `verify` go green before merging.

## Risks

| Risk | Mitigation |
| --- | --- |
| A behavior change hides inside a "behavior-preserving" refactor | Phase 2 is a checkpoint: the union must pass the whole integration suite with zero test edits before any interface changes |
| The authority field opens a hole | Default-deny. Absent means `assertStaff`. Only two literal values are accepted, and any other value is rejected rather than ignored |
| `transitionInventoryItem` loses its only guard | Nothing in this plan removes `assertStaff` from `transitionItem`. Phase 6 documents that the endpoint depends on it |
| `submitCartAs` deadlocks against its own locks | The shared helper receives an open `Tx` and must not re-lock rows the caller already holds. Called out explicitly in Phase 4 |
| CSV export headers change | `InventoryItemStaff` keeps its five flat fields; the union is internal only |

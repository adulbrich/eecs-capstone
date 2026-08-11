# Inventory Visibility Module Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give inventory the pure, client-safe, unit-tested visibility module that projects already has, collapse the duplicated staff predicates, and fix the retired rule that currently contradicts itself.

**Architecture:** `src/lib/viewer.ts` owns `isStaff` and `assertStaff` for every domain, which is what fixes `project-visibility.ts` exporting a predicate to seven non-project consumers. `src/lib/inventory-visibility.ts` owns the inventory decisions, with `canSeeRetired` as the single rule that both `visibleStatuses` (data, consumed by the SQL scope builder) and `canReadInventoryItem` (the single-row gate) derive from. Retired items become reachable for staff through a `retiredOnly` switch on `/admin/inventory`.

**Tech Stack:** TanStack Start server functions, Drizzle ORM on Postgres, React 19, shadcn/ui, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-08-11-inventory-visibility-module-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Commit messages, comments, docs, UI copy.
- **The public listing's behavior does not change.** A non-staff viewer never sees a retired item, whatever the request asks for.
- **The admin listing's default does not change.** Retired appears only when the new switch is on.
- **No change to `InventoryItemPublic` / `InventoryItemStaff` fields**, so CSV export columns and `edit.tsx`'s type guard are untouched.
- **No migration.**
- **Test commands need the sandbox disabled and a raised fd limit.**
  - Unit: `ulimit -n 8192; CI=true npm test`
  - Integration: `ulimit -n 8192; CI=true npm run test:integration` (docker Postgres up; truncates every table, so `npm run db:seed:dev` before any accessibility run)
  - Accessibility: `ulimit -n 8192; CI=true npm run test:accessibility`
- **Before every commit:** `npm run check` and `npm run typecheck` in full. `npm exec -- ultracite fix` resolves most formatting failures.
- **Stage files by name.** The working tree carries an unrelated uncommitted README edit that must not be swept up.
- **Never commit to `main`.** Work happens on `refactor/inventory-visibility-module`.
- **Every phase ends with a code review before the next begins.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/viewer.ts` | **new**: `isStaff`, `assertStaff` |
| `src/lib/__tests__/viewer.test.ts` | **new**: role matrix |
| `src/lib/inventory-visibility.ts` | **new**: `canSeeRetired`, `visibleStatuses`, `canReadInventoryItem`, `publicItemView`, `staffItemView`, the two view types |
| `src/lib/__tests__/inventory-visibility.test.ts` | **new** |
| `src/lib/project-visibility.ts` | re-exports `isStaff` from `viewer.ts` rather than defining it |
| `src/server/_internal/inventory.ts` | loses its private predicates and projections; scope builder derives from `visibleStatuses` |
| `src/server/_internal/{inventory-transitions,programs,categories,users}.ts` | drop their local `assertStaff` |
| `src/server/inventory.ts` | `listAdminInventorySchema` gains `retiredOnly` |
| `src/routes/_authed/admin/inventory/index.tsx` | the switch, the disabled status control |
| `src/server/__tests__/inventory.integration.test.ts` | retired visibility, both viewers |

---

## Phase 1: the viewer module

- [ ] Write `src/lib/__tests__/viewer.test.ts` first: admin and instructor are staff, user and anonymous are not, `assertStaff` throws `Forbidden` for the latter two and narrows for the former.
- [ ] Write `src/lib/viewer.ts`. `assertStaff` keeps the `asserts viewer is NonNullable<Viewer>` signature the inventory copy has; call sites rely on the narrowing.
- [ ] `src/lib/project-visibility.ts` re-exports `isStaff` from it rather than defining it, so its ten importers are untouched.
- [ ] Replace the five local `assertStaff` definitions. Check each call site still typechecks, since three take `AuthUser` and two take a looser `Viewer`.
- [ ] `npm test`, `check`, `typecheck` clean. Integration suite green with no test edits: this phase is behavior-preserving.
- [ ] Commit: `refactor(auth): give every domain one staff predicate`

## Phase 2: the inventory visibility module

- [ ] Write `src/lib/__tests__/inventory-visibility.test.ts` first, covering: `canSeeRetired` is staff-only; `visibleStatuses` excludes retired for everyone by default; `retiredOnly` returns exactly `["retired"]` for staff and is **ignored** for non-staff; `canReadInventoryItem` lets staff read a retired item and refuses everyone else; `publicItemView` omits every staff field; `staffItemView` includes them.
- [ ] Write `src/lib/inventory-visibility.ts`, defining its input types structurally rather than importing the Drizzle row type, following `project-visibility.ts`.
- [ ] Move `stripForPublic` and `fullForStaff` across as `publicItemView` and `staffItemView`, with `InventoryItemPublic` and `InventoryItemStaff`. Keep the re-export through `src/server/inventory.ts` so `edit.tsx` is untouched.
- [ ] Point `_internal/inventory.ts` at the module: `loadInventoryItemRowFor` uses `canReadInventoryItem`, and `buildInventoryScope` builds `inArray(status, visibleStatuses(...))` instead of `ne(status, "retired")`.
- [ ] Integration suite green with no test edits. This is the checkpoint: the SQL changed shape, so it has to prove it did not change results.
- [ ] Commit: `refactor(inventory): read visibility through one module`

## Phase 3: the staff-only retired filter

- [ ] `listAdminInventorySchema` gains `retiredOnly: z.boolean().default(false)`. `listInventorySchema` does **not**.
- [ ] `listAdminInventoryAs` passes it into `visibleStatuses`. Confirm `visibleStatuses` ignores it for a non-staff viewer, so the public path cannot reach retired rows even if something later passes the flag.
- [ ] `/admin/inventory` gains the `FilterSwitch` labelled "Show only retired", mirroring "Show soft-deleted" on `/admin/projects`, wired to a search param and `loaderDeps`.
- [ ] Disable the status `Select` while the switch is on.
- [ ] Integration tests: a staff viewer with `retiredOnly` sees only retired items; a staff viewer without it sees none; a non-staff viewer never sees retired.
- [ ] Accessibility suite green (needs `db:seed:dev` first). The admin toolbar gained a control.
- [ ] Commit: `feat(inventory): let staff list retired items`

## Phase 4: documentation

- [ ] `docs/QUIRKS.md`: record that retired is staff-only and reachable through the switch, that `visibleStatuses` is the one source and the SQL derives from it, and that `src/lib/viewer.ts` is where the staff predicate lives.
- [ ] `docs/QUIRKS.md`: correct the stale `stripStaffOnlyFields` reference in the projects entry; the function is `stripPrivateFields`.
- [ ] `README.md`: add the projects-projection follow-up this design argues for, that projects returns the whole row and nulls fields while inventory constructs its public shape.
- [ ] Commit: `docs(quirks): record the inventory visibility module`

## Phase 5: verify and open the PR

- [ ] `check`, `typecheck`, `npm test`, `build`, `check:compression`, `test:integration`, `test:accessibility` all clean.
- [ ] Push and open a PR. Merge with a **merge commit**, not a squash: this repo's history uses merge commits and PR #15 was squashed by mistake.

## Risks

| Risk | Mitigation |
| --- | --- |
| The SQL scope change alters results silently | Phase 2 is a checkpoint: the whole integration suite must pass with zero test edits before the filter is added |
| `retiredOnly` leaks to the public listing | The param is not in `listInventorySchema`, and `visibleStatuses` ignores it for non-staff, so two independent things must both fail. A test asserts the second |
| The five `assertStaff` call sites take different viewer shapes | Phase 1 typechecks each; three take `AuthUser`, two take a looser `Viewer` |
| Moving the view types breaks `edit.tsx` | The re-export through `src/server/inventory.ts` stays, so its import path is unchanged |

# Project Edit Diff Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the field-diffing TODO in `updateProjectAs` and delete the `noExcessiveCognitiveComplexity` suppression it justified, which takes two extractions rather than the one the TODO names.

**Architecture:** `diffProjectFields` is pure and moves to `src/lib/project-edit-diff.ts` with `PROJECT_EDITABLE_FIELDS`, where it can be unit tested without docker. `buildProjectValues` awaits a database read, so it stays private in `_internal/projects.ts` and exists only to make the caller readable. `updateProjectAs` ends up as authorize, build, diff, write.

**Spec:** `docs/superpowers/specs/2026-08-12-project-edit-diff-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **No behaviour change.** Same edit-log rows, same `changedFields` contents and order, same early return when nothing changed, same transaction.
- **`PROJECT_EDITABLE_FIELDS` keeps its exact contents and order.** The order decides the order of `changedFields`, which is stored in the edit log and rendered in the staff panel.
- **No wire-format change, no migration, no new dependency.**
- **Test commands:** `ulimit -n 8192; CI=true npm test` and `npm run test:integration` (docker Postgres). Vitest needs the sandbox off in this environment.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **No UI change, so the accessibility suite is not required**; run it only if something surprising turns up.
- **Stage files by name. Never commit to `main`.** Branch `refactor/project-edit-diff` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/project-edit-diff.ts` | new; `PROJECT_EDITABLE_FIELDS` and `diffProjectFields` |
| `src/lib/__tests__/project-edit-diff.test.ts` | new; the four rules, phantom-null guard first |
| `src/server/_internal/projects.ts` | loses the constant, the loop and the suppression; gains a private `buildProjectValues` |

---

## Phase 1: the pure module

- [ ] **Step 1: write the failing tests** at `src/lib/__tests__/project-edit-diff.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { diffProjectFields } from "../project-edit-diff";

describe("diffProjectFields", () => {
  it("skips a field the caller never offered", () => {
    // The rule worth protecting. A viewer who may not write `notes` never
    // contributes one, and `.set()` leaves the column alone. Diffing it anyway
    // would log a phantom "changed to null" against a value still in the row.
    const out = diffProjectFields(
      { notes: "staff only", title: "A" },
      { title: "A" }
    );
    expect(out.changedFields).toEqual([]);
    expect(out.oldDiff).toEqual({});
    expect(out.newDiff).toEqual({});
  });

  it("reports a field that changed, with both sides", () => {
    const out = diffProjectFields(
      { description: "old", title: "A" },
      { description: "new", title: "A" }
    );
    expect(out.changedFields).toEqual(["description"]);
    expect(out.oldDiff).toEqual({ description: "old" });
    expect(out.newDiff).toEqual({ description: "new" });
  });

  it("treats undefined and null as the same absence", () => {
    const out = diffProjectFields(
      { description: null, title: "A" },
      { description: undefined, title: "A" }
    );
    expect(out.changedFields).toEqual([]);
  });

  it("follows the declared field order, not key insertion order", () => {
    // changedFields is stored on the edit log and rendered in the staff panel,
    // so its order is observable.
    const out = diffProjectFields(
      { objectives: "a", title: "A", url: "u" },
      { objectives: "b", title: "B", url: "v" }
    );
    expect(out.changedFields).toEqual(["title", "objectives", "url"]);
  });

  it("ignores keys that are not editable fields", () => {
    const out = diffProjectFields(
      { searchVector: "old", title: "A" },
      { searchVector: "new", title: "A" }
    );
    expect(out.changedFields).toEqual([]);
  });
});
```

- [ ] **Step 2: run and confirm failure.** `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/project-edit-diff.test.ts`. Expected: module not found.

- [ ] **Step 3: create `src/lib/project-edit-diff.ts`.** Move `PROJECT_EDITABLE_FIELDS` from `projects.ts:38-55` verbatim, contents and order untouched, and the loop body from `:164-181` with its comment.

```ts
/**
 * Which columns a project edit may touch, and what changed between two
 * versions of one.
 *
 * Pure and client-safe so the rules below can be exercised without a database.
 * Asserting on `changedFields` used to cost a Postgres round trip and a Better
 * Auth sign-up.
 *
 * The order of this list is observable: it decides the order of
 * `changedFields`, which is stored on the edit log and rendered in the staff
 * panel.
 */
export const PROJECT_EDITABLE_FIELDS = [
  // ... verbatim from projects.ts
] as const;

export function diffProjectFields(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): {
  changedFields: string[];
  newDiff: Record<string, unknown>;
  oldDiff: Record<string, unknown>;
} {
  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const field of PROJECT_EDITABLE_FIELDS) {
    // A field the viewer was not allowed to write never made it into `next`,
    // and `.set()` leaves it alone. Diffing it anyway would log a phantom
    // "changed to null" edit for a value that is still in the row.
    if (!(field in next)) {
      continue;
    }
    const oldVal = existing[field] ?? null;
    const newVal = next[field] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      oldDiff[field] = oldVal;
      newDiff[field] = newVal;
      changedFields.push(field);
    }
  }
  return { changedFields, newDiff, oldDiff };
}
```

- [ ] **Step 4: run the tests.** Expected: PASS. Then `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`.

- [ ] **Step 5: commit.**

```bash
git add src/lib/project-edit-diff.ts src/lib/__tests__/project-edit-diff.test.ts
git commit -m "feat(projects): give field diffing a testable home"
```

---

## Phase 2: use it, and clear the suppression

- [ ] **Step 1: delete `PROJECT_EDITABLE_FIELDS` from `projects.ts`** and import it plus `diffProjectFields` from `#/lib/project-edit-diff`. Check whether anything else in the file uses the constant before deleting; grep first.

- [ ] **Step 2: extract `buildProjectValues`,** placed above `updateProjectAs`. Body moved verbatim from `:138-162`, with `staff` inlined as `isStaff(visibility)` since the local was only used there.

```ts
/**
 * What this edit writes, given who is making it.
 *
 * Server-side rather than in `src/lib/` beside the diff: the staff branch
 * resolves a proposer address to an account id, which is a database read. It
 * exists to keep `updateProjectAs` to four steps, not to be tested alone; the
 * integration suite already covers both branches.
 */
async function buildProjectValues(
  data: UpdateProjectInput,
  existing: Awaited<ReturnType<typeof loadProjectOr404>>,
  visibility: Viewer
): Promise<Record<string, unknown>> {
  // ... verbatim from :138-162, returning newValues
}
```

- [ ] **Step 3: reduce `updateProjectAs`** to authorize, build, diff, write:

```ts
export async function updateProjectAs(
  viewer: AuthUser,
  data: UpdateProjectInput,
  embed?: EmbedFn
): Promise<{ id: string; updated: boolean }> {
  const visibility = viewerToVisibility(viewer);
  const existing = await loadProjectOr404(data.id);
  if (!canEditProject(existing, visibility)) {
    throw new Error("Forbidden");
  }

  const newValues = await buildProjectValues(data, existing, visibility);
  const { changedFields, oldDiff, newDiff } = diffProjectFields(
    existing as unknown as Record<string, unknown>,
    newValues
  );

  if (changedFields.length === 0) {
    return { id: existing.id, updated: false };
  }
  // ... transaction, embedding and return unchanged
}
```

- [ ] **Step 4: delete the `biome-ignore` line** at `:125`.

- [ ] **Step 5: gate.** `npm run check` must pass **with no complexity error**, which is the point of the phase. Then `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, and `npm run test:integration`.

The two edit-log integration tests (`projects.integration.test.ts:169` and `:514`) must pass **unedited**. They are the proof the extraction was faithful.

- [ ] **Step 6: confirm the suppression is gone.**

Run: `grep -c 'noExcessiveCognitiveComplexity' src/server/_internal/projects.ts`
Expected: `0`

- [ ] **Step 7: commit.**

```bash
git add src/server/_internal/projects.ts
git commit -m "refactor(projects): close the field-diffing TODO"
```

---

## Phase 3: verify and open the PR

- [ ] **Step 1:** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`.
- [ ] **Step 2:** Push, open the PR, wait for `verify` and `integration`.

No `QUIRKS.md` entry: this closes a TODO and adds no rule a future reader has to know. The module's own docblock carries the one fact that matters, that the field order is observable.

## Risks

| Risk | Mitigation |
| --- | --- |
| The field order changes and `changedFields` reorders | The constant moves verbatim; the unit test pins declared order explicitly |
| Extracting the builder changes what gets written | Body moves verbatim. The two edit-log integration tests pass unedited, and `"does not let a proposer's save wipe notes staff added"` covers the conditional branch |
| Complexity still fails after both extractions | The spike already ran this exact shape and came out clean. If it fails, stop and report the score rather than extracting a third thing to chase a number |
| The `existing` cast in Step 3 hides a type error | It is the same cast the code does today at `:174`; the move does not introduce it |

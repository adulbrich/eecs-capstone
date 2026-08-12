# Debounced Search Draft Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the search-draft mirror one owner, which fixes a broken Back button on the public inventory filter bar and a timer that re-armed on every render, then close an unrelated race in the proposer lookup found on the way.

**Architecture:** `useDebouncedDraft(value, commit, delayMs?)` in `src/lib/use-debounced-draft.ts` owns all three pieces of the pattern: the draft state, the sync-back when the source value changes, and the debounced commit. Callers hold no state and write no effect. Router-agnostic, so it works whether `q` came from a search param or a prop.

**Spec:** `docs/superpowers/specs/2026-08-12-debounced-search-draft-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **No behaviour change at the five correct sites.** Same 300ms, same committed values, same `page: 1` where it already appears. Do not add or remove a `page: 1`: it appears exactly where a `page` search param exists.
- **Two deliberate behaviour changes, both fixes**, each in its own commit: Back on the inventory filter bar, and stale lookup results in the proposer picker.
- **Callers must pass a referentially stable `commit`.** Same contract `useAdminTableState` already places on `setSearch` and `replaceSearch`.
- **Test commands:** `ulimit -n 8192; CI=true npm test`. Vitest needs the sandbox off in this environment. No docker needed.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Six UI files change, so `npm run test:accessibility` is required** before the PR.
- **Stage files by name. Never commit to `main`.** Branch `fix/debounced-search-draft` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/use-debounced-draft.ts` | new; the whole mirror |
| `src/lib/__tests__/use-debounced-draft.test.tsx` | new; fake timers, including the Back regression |
| `src/routes/_authed/admin/{projects,users,inventory,mentors}/index.tsx` | adopt the hook |
| `src/components/projects-filter-bar.tsx` | adopt the hook |
| `src/components/inventory-filter-bar.tsx` | adopt the hook, which fixes both its bugs |
| `src/components/proposer-picker.tsx` | cancellation guard |

---

## Phase 1: the hook

- [ ] **Step 1: write the failing tests** at `src/lib/__tests__/use-debounced-draft.test.tsx`. Use `renderHook` from `@testing-library/react` and `vi.useFakeTimers()`, following `src/test/inventory-filter-bar.test.tsx:29-45` for the fake-timer shape.

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedDraft } from "../use-debounced-draft";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedDraft", () => {
  it("commits after the delay and not before", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("", commit));

    act(() => result.current[1]("ard"));
    expect(result.current[0]).toBe("ard");
    act(() => vi.advanceTimersByTime(290));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20));
    expect(commit).toHaveBeenCalledWith("ard");
  });

  it("coalesces rapid changes into one commit", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("", commit));

    act(() => result.current[1]("a"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current[1]("ar"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current[1]("ard"));
    act(() => vi.advanceTimersByTime(310));

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("ard");
  });

  it("resets the draft when the value changes underneath", () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "old" } }
    );

    rerender({ v: "new" });
    expect(result.current[0]).toBe("new");
  });

  it("does not write the old draft back when the value changes underneath", () => {
    // The regression. This is browser Back: the URL's q changes, and a draft
    // holding the previous value must not be committed over the top of it
    // 300ms later. inventory-filter-bar did exactly that.
    const commit = vi.fn();
    const { rerender } = renderHook(
      ({ v }) => useDebouncedDraft(v, commit),
      { initialProps: { v: "old" } }
    );

    rerender({ v: "new" });
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not commit when the draft already equals the value", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft("same", commit));

    act(() => result.current[1]("same"));
    act(() => vi.advanceTimersByTime(500));
    expect(commit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: run and confirm failure.** `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/use-debounced-draft.test.tsx`.

- [ ] **Step 3: build the hook.** House style per `src/lib/use-has-mounted.ts`: kebab-case file, named export, explicit return type, JSDoc naming the concrete bug it prevents.

```ts
import { useEffect, useState } from "react";

/**
 * A local draft of a value that lives somewhere slower, committed back after a
 * pause. The search boxes use it so typing feels immediate while the URL only
 * changes once the user stops.
 *
 * It owns three things, and the third is why this exists rather than a bare
 * debounce helper: the draft, the commit, and **resyncing the draft when the
 * value changes underneath**. `src/components/inventory-filter-bar.tsx` had the
 * first and second and not the third, so browser Back changed the URL, the
 * stale draft survived, and 300ms later it was written straight back over the
 * top. Owning all three makes that unrepresentable at a call site.
 *
 * `commit` must be referentially stable, the same contract `useAdminTableState`
 * places on `setSearch` and `replaceSearch`: an unstable callback re-arms the
 * timer on every render instead of on every change.
 *
 * Router-agnostic on purpose, taking a value and a callback instead of reaching
 * for `useNavigate`, which keeps it unit-testable.
 */
export function useDebouncedDraft(
  value: string,
  commit: (next: string) => void,
  delayMs = 300
): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) {
      return;
    }
    const t = setTimeout(() => commit(draft), delayMs);
    return () => clearTimeout(t);
  }, [draft, value, commit, delayMs]);

  return [draft, setDraft];
}
```

Note the ordering that makes the regression test pass: when `value` changes, the sync effect sets `draft` to the new value, so the commit effect's `draft === value` guard short-circuits and no timer is armed.

- [ ] **Step 4: run the tests.** Expected: PASS. Then `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`.

- [ ] **Step 5: commit.**

```bash
git add src/lib/use-debounced-draft.ts src/lib/__tests__/use-debounced-draft.test.tsx
git commit -m "feat(ui): give the search draft one owner"
```

---

## Phase 2: adopt it at the five correct sites

No behaviour change here. Each site loses a `useState`, a sync effect and a debounce effect, and gains one `useCallback`.

- [ ] **Step 1: `src/routes/_authed/admin/projects/index.tsx`** (`:386-395`). Replace the draft state and both effects:

```ts
  const commitQuery = useCallback(
    (next: string) => {
      navigate({ search: (prev) => ({ ...prev, q: next }) });
    },
    [navigate]
  );
  const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);
```

Keep the existing `navigate({ search: ... })` body exactly as it is, including whether it spreads `prev`.

- [ ] **Step 2: `src/routes/_authed/admin/users/index.tsx`** (`:195-208`). Same shape. **Keep `page: 1`** in the commit body; users has a `page` search param.

- [ ] **Step 3: `src/routes/_authed/admin/inventory/index.tsx`** (`:414`, `:424-433`). Same shape, no `page: 1`.

- [ ] **Step 4: `src/routes/_authed/admin/mentors/index.tsx`** (`:194`, `:204-213`). Same shape, no `page: 1`.

- [ ] **Step 5: `src/components/projects-filter-bar.tsx`** (`:51`, `:78-89`). Same shape. **Keep `page: 1`**.

- [ ] **Step 6: gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`. Confirm no `setTimeout` remains in those five files: `grep -c setTimeout` on each returns `0`.

- [ ] **Step 7: commit.**

```bash
git add src/routes/_authed/admin/projects/index.tsx src/routes/_authed/admin/users/index.tsx \
  src/routes/_authed/admin/inventory/index.tsx src/routes/_authed/admin/mentors/index.tsx \
  src/components/projects-filter-bar.tsx
git commit -m "refactor(ui): read the search draft through the hook"
```

---

## Phase 3: fix the inventory filter bar

Behaviour change. Own commit.

- [ ] **Step 1: replace `InventoryFilterBar`'s draft and effect** (`src/components/inventory-filter-bar.tsx:43-51`):

```ts
  const [localQ, setLocalQ] = useDebouncedDraft(props.q, props.onQChange);
```

Both bugs go: the sync-back arrives with the hook, and the dependency array stops including `props`.

- [ ] **Step 2: check the parent passes a stable callback.** `src/routes/inventory/index.tsx` around `:87-89` supplies `onQChange`. If it is an inline arrow, wrap it in `useCallback`; otherwise the hook re-arms on every parent render, which is the bug being fixed. This step is required, not optional.

- [ ] **Step 3: confirm the existing test still passes** unedited: `src/test/inventory-filter-bar.test.tsx:29` "debounces search input". It is the wiring proof.

- [ ] **Step 4: prove the fix.** Add one case to that file: render with `q="new"` after the component has held a draft of `"old"`, advance the timers, and assert `onQChange` was not called. Confirm it fails if you revert Step 1.

- [ ] **Step 5: gate and commit.**

```bash
git add src/components/inventory-filter-bar.tsx src/routes/inventory/index.tsx src/test/inventory-filter-bar.test.tsx
git commit -m "fix(inventory): stop the filter bar undoing browser Back"
```

---

## Phase 4: the proposer picker race

Unrelated to the extraction. Own commit.

- [ ] **Step 1: add the cancellation guard** at `src/components/proposer-picker.tsx:40-55`, mirroring `src/components/holder-field.tsx:63-72` exactly: a `let cancelled = false` in the effect body, set to `true` in the cleanup, checked after the await on both the success and catch paths before calling `setMatches`.

- [ ] **Step 2: gate.** `npm run check`, `npm run typecheck`, and `src/test/proposer-picker.test.tsx` (11 tests) passing unedited.

- [ ] **Step 3: commit.**

```bash
git add src/components/proposer-picker.tsx
git commit -m "fix(projects): drop superseded proposer lookup results"
```

---

## Phase 5: verify and open the PR

- [ ] **Step 1:** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`.
- [ ] **Step 2:** `npm run db:seed:dev`, then `npm run test:accessibility`. Six UI files changed.
- [ ] **Step 3:** Push, open the PR, wait for `verify` and `integration`.

No `QUIRKS.md` entry: the hook's JSDoc carries the one fact a future reader needs, which is the stable-callback contract, and it sits next to the code rather than in a doc.

## Risks

| Risk | Mitigation |
| --- | --- |
| A call site passes an unstable `commit` and the timer re-arms per render | The contract is in the JSDoc, and Phase 3 Step 2 explicitly checks the one caller that passes it as a prop |
| The sync effect and the commit effect fight, committing on mount | The `draft === value` guard makes the mount tick a no-op, which is what the five correct sites already relied on. Test four pins it |
| A route's `navigate` body changes shape during the move | Phase 2 says to keep each body exactly as written, including whether it spreads `prev` |
| The Back fix is asserted vacuously | Phase 3 Step 4 says to confirm it fails when Step 1 is reverted |

import { useEffect, useRef, useState } from "react";

/**
 * A local draft of a value that lives somewhere slower, committed back after a
 * pause. The search boxes use it so typing feels immediate while the URL only
 * changes once the user stops.
 *
 * It owns three things, and the third is why this exists rather than a bare
 * debounce helper: the draft, the debounced commit, and **resyncing the draft
 * when the value changes underneath**. `inventory-filter-bar.tsx` (now `inventory-filters.tsx`) had the first
 * two and not the third, so browser Back changed the URL, the stale draft
 * survived, and 300ms later it was written straight back over the top. Owning
 * all three makes that unrepresentable at a call site.
 *
 * Its own commits come back late: `Route.useSearch()` moves only once the
 * loader resolves, so a commit returns a round trip after it fires, and
 * resyncing to it dropped every key typed in between (#501). So both effects
 * compare against `expected`, what this last committed or synced to, rather
 * than against `value`. A `value` equal to it is the echo; anything else is a
 * change underneath.
 *
 * `commit` must be referentially stable, the same contract `useAdminTableState`
 * places on `setSearch` and `replaceSearch`: an unstable callback re-arms the
 * timer on every render instead of on every change. That was the second bug in
 * the same file, whose effect depended on the whole props object.
 *
 * Router-agnostic on purpose, taking a value and a callback rather than
 * reaching for `useNavigate`, which is what keeps it unit-testable and lets it
 * serve a caller whose value arrives as a prop. What it needs from the source
 * instead: `value` comes back exactly as committed (a `.trim()` on a `q` schema
 * brings #501 back), and a commit overtaken by a later one never comes back at
 * all, which holds because the router drops a superseded load.
 */
export function useDebouncedDraft(
  value: string,
  commit: (next: string) => void,
  delayMs = 300
): [string, (next: string) => void] {
  const [draft, setDraft] = useState(value);
  const expected = useRef(value);

  useEffect(() => {
    if (value === expected.current) {
      return;
    }
    expected.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    // Against `expected`, not `value`: when Back cancels a commit before it
    // lands, `value` never moves, and a draft cleared back to it must still
    // be committed, or Forward to the cancelled value reads as its echo.
    if (draft === expected.current) {
      return;
    }
    // A Back or Forward before this fires moves `expected`, and the draft it
    // was armed for is stale, even when the step landed on exactly that text
    // and so re-rendered nothing.
    const armedAt = expected.current;
    const t = setTimeout(() => {
      if (expected.current !== armedAt) {
        return;
      }
      expected.current = draft;
      commit(draft);
    }, delayMs);
    return () => clearTimeout(t);
  }, [draft, commit, delayMs]);

  return [draft, setDraft];
}

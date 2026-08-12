import { useEffect, useState } from "react";

/**
 * A local draft of a value that lives somewhere slower, committed back after a
 * pause. The search boxes use it so typing feels immediate while the URL only
 * changes once the user stops.
 *
 * It owns three things, and the third is why this exists rather than a bare
 * debounce helper: the draft, the debounced commit, and **resyncing the draft
 * when the value changes underneath**. `inventory-filter-bar.tsx` had the first
 * two and not the third, so browser Back changed the URL, the stale draft
 * survived, and 300ms later it was written straight back over the top. Owning
 * all three makes that unrepresentable at a call site.
 *
 * `commit` must be referentially stable, the same contract `useAdminTableState`
 * places on `setSearch` and `replaceSearch`: an unstable callback re-arms the
 * timer on every render instead of on every change. That was the second bug in
 * the same file, whose effect depended on the whole props object.
 *
 * Router-agnostic on purpose, taking a value and a callback rather than
 * reaching for `useNavigate`, which is what keeps it unit-testable and lets it
 * serve a caller whose value arrives as a prop.
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
    // Also what makes the mount tick a no-op, and what stops a value that
    // changed underneath from being overwritten: the sync above has already
    // set the draft to match by the time this runs.
    if (draft === value) {
      return;
    }
    const t = setTimeout(() => commit(draft), delayMs);
    return () => clearTimeout(t);
  }, [draft, value, commit, delayMs]);

  return [draft, setDraft];
}

import { useEffect } from "react";
import type { ViewMode } from "#/lib/view-preference";
import { readStoredView } from "#/lib/view-preference";

/**
 * Seeds the list view from the persisted preference on first render.
 *
 * The `?view=` URL param remains the source of truth: when it is present
 * (`current` is defined) this is a no-op so shared links keep winning. Only on a
 * param-less visit does the stored preference get applied, via `seed`, which the
 * caller wires to a `navigate({ replace: true })`.
 */
export function useSeedViewFromStorage(
  current: ViewMode | undefined,
  seed: (view: ViewMode) => void
) {
  useEffect(() => {
    if (current !== undefined) {
      return;
    }
    const stored = readStoredView();
    if (stored) {
      seed(stored);
    }
  }, [current, seed]);
}

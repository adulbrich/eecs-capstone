import { useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { searchParamQuerySchema } from "./search-query";
import { useDebouncedDraft } from "./use-debounced-draft";

/**
 * A listing search box's draft of the URL's `q`: `useDebouncedDraft` fed from
 * the router's location rather than from `Route.useSearch()` (#588).
 *
 * `Route.useSearch()` moves only once the loader resolves, so a commit that
 * Back or Forward cancels before it lands never moves it at all, and the hook
 * could not see the step: the box kept the cancelled text, or took a history
 * step that landed on its own last commit for that commit's echo and wrote
 * the latest draft over it. The location moves the moment `navigate()` or a
 * history step does, so every step reaches the hook as it happens.
 *
 * Only while the location is on the page the box mounted on. A click through
 * to another page moves the location first and unmounts the listing only
 * once that page loads, and reading the new page's missing `q` meanwhile
 * would blank the box under the reader for the whole load, so a location on
 * another pathname holds the last `q`. The mount's own pathname, not
 * `resolvedLocation`'s: on a mount by client navigation that still names the
 * page being left, and the box mounted empty.
 *
 * In one place rather than at each call site, where an eighth search box
 * reading `Route.useSearch().q` would bring the bug back. The raw location is
 * parsed with the same `searchParamQuerySchema` the routes validate `q` with,
 * so a hand-typed `?q=123`, which the router parses to a number, reads as the
 * route reads it.
 *
 * `commit` must be referentially stable, as for `useDebouncedDraft`.
 */
export function useSearchDraft(
  commit: (next: string) => void,
  delayMs?: number
): [string, (next: string) => void] {
  const pathname = useRouterState({
    select: ({ location }) => location.pathname,
  });
  const q = useRouterState({
    select: ({ location }) =>
      searchParamQuerySchema.parse(
        (location.search as Record<string, unknown>).q
      ),
  });
  const [mountedOn] = useState(pathname);
  const onPage = pathname === mountedOn;
  // Set during render, React's pattern for state derived from a prop, so the
  // hold is the last `q` read on this page with no effect lagging a frame.
  const [held, setHeld] = useState(q);
  if (onPage && q !== held) {
    setHeld(q);
  }
  return useDebouncedDraft(onPage ? q : held, commit, delayMs);
}

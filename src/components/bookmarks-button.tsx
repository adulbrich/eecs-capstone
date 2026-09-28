import { useQuery } from "@tanstack/react-query";
import { isRedirect, Link } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { useSignedInUserId } from "#/lib/use-signed-in";
import { listMyBookmarks } from "#/server/bookmarks";
import { CountBadge } from "./count-badge";
import { Button } from "./ui/button";

/**
 * The viewer's bookmark count on the `/projects` title row, the sibling of
 * `BorrowListButton` on `/inventory`.
 *
 * Reads the same list `/my/bookmarks` renders rather than a separate count
 * query, so the number here is by construction the number of rows there:
 * `listMyBookmarksAs` re-checks visibility on read, and a count that skipped
 * that check would overstate a list that got shorter.
 *
 * The key carries the user id (docs/QUIRKS.md, "A TanStack Query key for the
 * viewer's own data carries their user id"); `useWriteBookmark` invalidates
 * the `["bookmarks"]` prefix, which reaches it.
 */
export function BookmarksButton() {
  const userId = useSignedInUserId();
  const { data } = useQuery({
    queryKey: ["bookmarks", userId],
    queryFn: async () => {
      try {
        return await listMyBookmarks();
      } catch (error) {
        // The server ended the session before this tab heard, and a redirect
        // a query throws navigates the tab (docs/QUIRKS.md, "A redirect
        // thrown from a `queryFn` navigates the tab").
        if (isRedirect(error)) {
          return { rows: [] };
        }
        throw error;
      }
    },
    enabled: userId !== undefined,
  });
  if (userId === undefined) {
    return null;
  }
  const count = data?.rows.length ?? 0;
  return (
    <Button asChild size="sm" variant="outline">
      <Link to="/my/bookmarks">
        <Bookmark aria-hidden="true" />
        Bookmarks <CountBadge count={count} />
      </Link>
    </Button>
  );
}

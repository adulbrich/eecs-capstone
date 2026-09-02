import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { useSignedIn } from "#/lib/use-signed-in";
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
 */
export function BookmarksButton() {
  const signedIn = useSignedIn();
  const { data } = useQuery({
    queryKey: ["bookmarks"],
    queryFn: () => listMyBookmarks(),
    enabled: signedIn,
  });
  if (!signedIn) {
    return null;
  }
  const count = data?.rows.length ?? 0;
  return (
    <Button asChild size="sm" variant="outline">
      <Link to="/my/bookmarks">
        <Bookmark aria-hidden="true" className="h-4 w-4" />
        Bookmarks <CountBadge count={count} />
      </Link>
    </Button>
  );
}

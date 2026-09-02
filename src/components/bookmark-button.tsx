import { useEffect, useState } from "react";
import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";
import { isBookmarked } from "#/server/bookmarks";
import { BookmarkIcon, useWriteBookmark } from "./bookmark-set";
import { Button } from "./ui/button";

export function BookmarkButton({ projectId }: { projectId: string }) {
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const writeBookmark = useWriteBookmark();
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      return;
    }
    void (async () => {
      try {
        const { bookmarked: b } = await isBookmarked({ data: { projectId } });
        setBookmarked(b);
      } catch {
        setBookmarked(false);
      }
    })();
  }, [session?.user, projectId]);

  // The server always renders nothing here (it has no session), so the first
  // client render must too, or this button appears where the server put the
  // next sibling and React discards the tree as a hydration mismatch.
  if (!(hasMounted && session?.user)) {
    return null;
  }

  async function toggle() {
    setLoading(true);
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await writeBookmark(projectId, next);
    } catch (err) {
      setBookmarked(!next);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      disabled={loading}
      onClick={() => void toggle()}
      size="sm"
      title={bookmarked ? "Remove bookmark" : "Bookmark"}
      type="button"
      variant="outline"
    >
      <BookmarkIcon bookmarked={bookmarked} />
      {bookmarked ? "Bookmarked" : "Bookmark"}
    </Button>
  );
}

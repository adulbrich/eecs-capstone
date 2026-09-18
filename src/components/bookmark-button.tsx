import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "#/lib/auth-client";
import { errorMessage } from "#/lib/error-message";
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
  // The first render shows a guess, and the read below replaces it. A click in
  // that window writes a row the read cannot see, because the read was computed
  // before the insert, so its answer would put the button back to the state the
  // viewer just left and the page would contradict the database (#444). Each
  // write takes the next number; the read writes back only if the number it
  // started with is still current. Same shape as `comment-thread.tsx`'s
  // `attempt`, one counter for the whole component because there is one field.
  const writes = useRef(0);

  useEffect(() => {
    if (!session?.user) {
      return;
    }
    const startedAt = writes.current;
    void (async () => {
      let answer = false;
      try {
        const { bookmarked: b } = await isBookmarked({ data: { projectId } });
        answer = b;
      } catch {
        answer = false;
      }
      if (writes.current === startedAt) {
        setBookmarked(answer);
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
    writes.current += 1;
    setLoading(true);
    const next = !bookmarked;
    setBookmarked(next);
    try {
      await writeBookmark(projectId, next);
    } catch (err) {
      setBookmarked(!next);
      toast.error(errorMessage(err, "Could not save the bookmark"));
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
      {/*
        Text from `md` only: on a phone this is the small icon button right
        of the project title (#400). The aria-label above is the accessible
        name at every width, so no role query changes.
      */}
      <span className="hidden md:inline">
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </span>
    </Button>
  );
}

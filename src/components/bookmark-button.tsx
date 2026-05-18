import { BookmarkIcon as BookmarkOutline } from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid } from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import { authClient } from "#/lib/auth-client";
import { addBookmark, isBookmarked, removeBookmark } from "#/server/bookmarks";

export function BookmarkButton({ projectId }: { projectId: string }) {
  const { data: session } = authClient.useSession();
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    void (async () => {
      try {
        const { bookmarked } = await isBookmarked({ data: { projectId } });
        setBookmarked(bookmarked);
      } catch {
        setBookmarked(false);
      }
    })();
  }, [session?.user, projectId]);

  if (!session?.user) return null;

  async function toggle() {
    setLoading(true);
    const next = !bookmarked;
    setBookmarked(next);
    try {
      if (next) await addBookmark({ data: { projectId } });
      else await removeBookmark({ data: { projectId } });
    } catch (err) {
      setBookmarked(!next);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={loading}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      title={bookmarked ? "Remove bookmark" : "Bookmark"}
      className="inline-flex items-center gap-1 border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
    >
      {bookmarked ? (
        <BookmarkSolid className="h-4 w-4 text-amber-600" />
      ) : (
        <BookmarkOutline className="h-4 w-4" />
      )}
      {bookmarked ? "Bookmarked" : "Bookmark"}
    </button>
  );
}

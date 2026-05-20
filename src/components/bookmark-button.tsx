import { Bookmark } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "#/lib/auth-client";
import { addBookmark, isBookmarked, removeBookmark } from "#/server/bookmarks";
import { Button } from "./ui/button";

export function BookmarkButton({ projectId }: { projectId: string }) {
  const { data: session } = authClient.useSession();
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    void (async () => {
      try {
        const { bookmarked: b } = await isBookmarked({ data: { projectId } });
        setBookmarked(b);
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
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void toggle()}
      disabled={loading}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      title={bookmarked ? "Remove bookmark" : "Bookmark"}
    >
      <Bookmark
        className="h-4 w-4"
        style={{
          fill: bookmarked ? "var(--status-warning)" : "none",
          color: bookmarked ? "var(--status-warning)" : undefined,
        }}
      />
      {bookmarked ? "Bookmarked" : "Bookmark"}
    </Button>
  );
}

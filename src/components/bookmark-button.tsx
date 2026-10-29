import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "#/lib/error-message";
import { useSignedInUserId } from "#/lib/use-signed-in";
import { isBookmarked } from "#/server/bookmarks";
import { BookmarkIcon, bookmarkLabel, useWriteBookmark } from "./bookmark-set";
import { Button } from "./ui/button";

export function BookmarkButton({ projectId }: { projectId: string }) {
  // Undefined until the client has mounted: the server renders nothing here
  // (it has no session), so the first client render must too, or this button
  // appears where the server put the next sibling and React discards the tree
  // as a hydration mismatch.
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const writeBookmark = useWriteBookmark();
  const [loading, setLoading] = useState(false);
  // Under the `["bookmarks"]` prefix every writer invalidates, and keyed on
  // the viewer and the project, so a read for the previous project or
  // session never lands on this one.
  const queryKey = ["bookmarks", userId, projectId];
  const { data: bookmarked = false } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const { bookmarked: b } = await isBookmarked({ data: { projectId } });
        return b;
      } catch (error) {
        // The session ended before this tab heard (docs/QUIRKS.md, "A
        // redirect thrown from a `queryFn` navigates the tab").
        if (isRedirect(error)) {
          return false;
        }
        throw error;
      }
    },
    enabled: userId !== undefined,
  });

  if (userId === undefined) {
    return null;
  }

  async function toggle() {
    // A click decides the value outright. A read still in flight was computed
    // before the write, so its answer would put the button back to the state
    // the viewer just left and the page would contradict the database (#444):
    // cancel it before the optimistic value goes in.
    // Disabled first, synchronously, so a second click in the await below
    // cannot toggle again from the same value.
    setLoading(true);
    await queryClient.cancelQueries({ queryKey });
    const next = !bookmarked;
    queryClient.setQueryData(queryKey, next);
    try {
      await writeBookmark(projectId, next);
    } catch (err) {
      queryClient.setQueryData(queryKey, !next);
      toast.error(errorMessage(err, "Could not save the bookmark"));
    } finally {
      setLoading(false);
    }
  }

  const label = bookmarkLabel(bookmarked);
  return (
    <Button
      aria-label={label}
      disabled={loading}
      onClick={() => void toggle()}
      size="sm"
      title={label}
      type="button"
      variant="outline"
    >
      <BookmarkIcon bookmarked={bookmarked} />
      {/*
        Text from `md` only: on a phone this is the small icon button right
        of the project title (#400). The aria-label above is the accessible
        name at every width, and it starts with the word shown here, so what
        a voice user reads off the button is in its name (#789).
      */}
      <span className="hidden md:inline">
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </span>
    </Button>
  );
}

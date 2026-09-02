import { Bookmark } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";
import {
  addBookmark,
  listMyBookmarkIds,
  removeBookmark,
} from "#/server/bookmarks";
import { Button } from "./ui/button";

/**
 * Persists one bookmark state. Shared by the listing toggle below and the
 * detail page's `BookmarkButton`, which own their state differently but
 * write it the same way.
 */
export async function writeBookmark(projectId: string, bookmarked: boolean) {
  if (bookmarked) {
    await addBookmark({ data: { projectId } });
  } else {
    await removeBookmark({ data: { projectId } });
  }
}

/** The glyph both bookmark controls draw, filled when set. */
export function BookmarkIcon({ bookmarked }: { bookmarked: boolean }) {
  return (
    <Bookmark
      className="h-4 w-4"
      style={{
        fill: bookmarked ? "var(--status-warning)" : "none",
        color: bookmarked ? "var(--status-warning)" : undefined,
      }}
    />
  );
}

interface BookmarkSet {
  has: (projectId: string) => boolean;
  set: (projectId: string, bookmarked: boolean) => void;
}

const BookmarkSetContext = createContext<BookmarkSet | null>(null);

/**
 * The viewer's bookmarked project ids, fetched once for a whole listing.
 *
 * `BookmarkButton` on the detail page asks the server about its one project
 * on mount. Twenty of those on a listing page would be twenty requests, so
 * the listing wraps its rows in this provider and each `BookmarkToggle` reads
 * the shared set instead.
 *
 * The value is null until the client has mounted, the viewer is signed in,
 * and the fetch has landed. The server always renders without a session, so
 * the first client render must produce the same markup or React discards the
 * tree as a hydration mismatch; `useHasMounted` is what holds the first
 * render to the server's answer.
 */
export function BookmarkSetProvider({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const userId = hasMounted ? (session?.user?.id ?? null) : null;
  const [ids, setIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!userId) {
      setIds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { ids: fetched } = await listMyBookmarkIds();
        if (!cancelled) {
          setIds(new Set(fetched));
        }
      } catch {
        if (!cancelled) {
          setIds(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<BookmarkSet | null>(() => {
    if (!ids) {
      return null;
    }
    return {
      has: (projectId) => ids.has(projectId),
      set: (projectId, bookmarked) =>
        setIds((previous) => {
          if (!previous) {
            return previous;
          }
          const next = new Set(previous);
          if (bookmarked) {
            next.add(projectId);
          } else {
            next.delete(projectId);
          }
          return next;
        }),
    };
  }, [ids]);

  return (
    <BookmarkSetContext.Provider value={value}>
      {children}
    </BookmarkSetContext.Provider>
  );
}

/**
 * The icon-only bookmark control for a listing row. Renders nothing until the
 * enclosing `BookmarkSetProvider` has a set, which covers every case in which
 * there is nobody to bookmark for: outside a provider, before mount, signed
 * out, or before the ids arrive.
 *
 * The labels match `BookmarkButton` on the detail page, so a role query for
 * "Bookmark" or "Remove bookmark" finds either.
 */
export function BookmarkToggle({
  className,
  projectId,
}: {
  className?: string;
  projectId: string;
}) {
  const set = useContext(BookmarkSetContext);
  const [loading, setLoading] = useState(false);
  if (!set) {
    return null;
  }
  const bookmarked = set.has(projectId);
  const label = bookmarked ? "Remove bookmark" : "Bookmark";

  async function toggle() {
    if (!set) {
      return;
    }
    const next = !bookmarked;
    setLoading(true);
    set.set(projectId, next);
    try {
      await writeBookmark(projectId, next);
    } catch (err) {
      set.set(projectId, !next);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      aria-label={label}
      className={className}
      disabled={loading}
      onClick={() => void toggle()}
      size="icon-sm"
      title={label}
      type="button"
      variant="outline"
    >
      <BookmarkIcon bookmarked={bookmarked} />
    </Button>
  );
}

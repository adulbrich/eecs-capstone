import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { defineAdminColumns } from "#/components/admin-data-table";
import { projectImageSrc } from "#/lib/project-image";
import type { SortState } from "#/lib/table-state";
import { type listMyBookmarks, removeBookmark } from "#/server/bookmarks";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { projectSummaryColumns } from "./project-summary-columns";
import { StatusBadge } from "./status-badge";
import { Button } from "./ui/button";

/** One row of `/my/bookmarks`, as `listMyBookmarks` returns it. */
export type BookmarkRow = Awaited<
  ReturnType<typeof listMyBookmarks>
>["rows"][number];

/** Newest save first, which is the order the page always had. */
export const BOOKMARK_TABLE_DEFAULT_SORT: SortState = {
  desc: true,
  id: "savedAt",
};

/**
 * The bookmark toggle, for a page whose rows are the bookmarks: removing one
 * removes the row, so the loader is what has to refresh, not a shared set.
 */
function RemoveBookmarkButton({ row }: { row: BookmarkRow }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function remove() {
    setPending(true);
    try {
      await removeBookmark({ data: { projectId: row.id } });
      await router.invalidate();
    } catch (err) {
      // The row stays, which is the truth; say why rather than leaving a
      // button that seemed to do nothing.
      console.error(err);
      toast.error("Could not remove the bookmark. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Button
      aria-label={`Remove ${row.title} from bookmarks`}
      disabled={pending}
      onClick={() => void remove()}
      size="sm"
      type="button"
      variant="ghost"
    >
      Remove
    </Button>
  );
}

const shared = projectSummaryColumns<BookmarkRow>();

/**
 * A fixed, small, decision-oriented set: no column picker, no card mode. Every
 * column is a field `listMyBookmarksAs` already returns, and that projection
 * re-checks visibility on read, so nothing here is disclosed that the viewer
 * could not open. `enableHiding: false` throughout is what removes the picker.
 * The five columns shared with /projects come from `projectSummaryColumns`.
 */
export const BOOKMARK_TABLE_COLUMNS = defineAdminColumns<BookmarkRow>()([
  {
    accessorFn: (row) => row.title,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={projectImageSrc(row.original.imageUrl)}
        />
        <Link
          className="hover:underline"
          params={{ projectId: row.original.id }}
          to="/projects/$projectId"
        >
          {row.original.title}
        </Link>
      </div>
    ),
    cardHeader: true,
    enableHiding: false,
    header: "Title",
    id: "title",
  },
  { ...shared.program, enableHiding: false },
  {
    accessorFn: (row) => row.status,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    enableHiding: false,
    header: "Status",
    id: "status",
  },
  { ...shared.accepting, enableHiding: false },
  { ...shared.teams, enableHiding: false },
  { ...shared.nda, enableHiding: false },
  // Named for what it answers here, "where did this project come from",
  // which is the same two facts /projects files under Mentorship.
  { ...shared.mentorship, enableHiding: false, header: "Origin" },
  {
    accessorFn: (row) => row.bookmarkedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.bookmarkedAt} />,
    enableHiding: false,
    header: "Saved on",
    id: "savedAt",
    // Chronological, not text: the default would compare Date strings, which
    // begin with the weekday.
    sortingFn: "datetime",
  },
  {
    cell: ({ row }) => <RemoveBookmarkButton row={row.original} />,
    enableHiding: false,
    enableSorting: false,
    header: "Remove",
    id: "remove",
  },
]);

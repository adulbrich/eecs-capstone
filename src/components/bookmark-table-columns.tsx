import { Link } from "@tanstack/react-router";
import { defineAdminColumns } from "#/components/admin-data-table";
import { projectImageSrc } from "#/lib/project-image";
import type { SortState } from "#/lib/table-state";
import type { listMyBookmarks } from "#/server/bookmarks";
import { BookmarkToggle } from "./bookmark-set";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { projectSummaryColumns } from "./project-summary-columns";
import { StatusBadge } from "./status-badge";

/** One row of `/my/bookmarks`, as `listMyBookmarks` returns it. */
export type BookmarkRow = Awaited<
  ReturnType<typeof listMyBookmarks>
>["rows"][number];

/** Newest save first, which is the order the page always had. */
export const BOOKMARK_TABLE_DEFAULT_SORT: SortState = {
  desc: true,
  id: "savedAt",
};

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
      <div className="flex items-center gap-2 md:min-w-xs md:max-w-md">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={projectImageSrc(row.original.imageUrl)}
        />
        <Link
          className="min-w-0 hover:underline md:line-clamp-2 md:whitespace-normal"
          params={{ projectId: row.original.id }}
          title={row.original.title}
          to="/projects/$projectId"
        >
          {row.original.title}
        </Link>
        {/*
          The same control in the same place as /projects table mode, rather
          than a Remove button in a column of its own. The row stays after an
          un-bookmark and the toggle shows its unset state, which is what makes
          it a toggle: one that deletes its own row can never show that state,
          and a misclick cost a trip back to the listing to find the project
          again. The loader still returns bookmarks, so a reload drops it.
        */}
        <BookmarkToggle className="ml-auto" projectId={row.original.id} />
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
  { ...shared.badges, enableHiding: false },
  { ...shared.teams, enableHiding: false },
  {
    accessorFn: (row) => row.bookmarkedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.bookmarkedAt} />,
    enableHiding: false,
    header: "Saved on",
    id: "savedAt",
    // Chronological, not text: the default would compare Date strings, which
    // begin with the weekday.
    sortFn: "datetime",
  },
]);

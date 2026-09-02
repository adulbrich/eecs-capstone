import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { defineAdminColumns } from "#/components/admin-data-table";
import { projectImageSrc } from "#/lib/project-image";
import type { SortState } from "#/lib/table-state";
import { type listMyBookmarks, removeBookmark } from "#/server/bookmarks";
import { ApplicantsBadge } from "./applicants-badge";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { programLabel } from "./project-card";
import { StatusBadge } from "./status-badge";
import { Badge } from "./ui/badge";
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
 * Both of #75's public facts in one cell. Mentor state only means anything
 * on a student-proposed project, so a mentor column of its own would be blank
 * on most rows; combined, blank honestly means "an ordinary proposal" rather
 * than looking like missing data.
 */
export function originLabel(row: {
  mentorName: string | null;
  seekingMentor: boolean;
  studentProposed: boolean;
}): string | null {
  if (!row.studentProposed) {
    return null;
  }
  if (row.seekingMentor) {
    return "Student proposed, seeking mentor";
  }
  if (row.mentorName) {
    return `Student proposed, mentored by ${row.mentorName}`;
  }
  // A mentor address is on file but nobody has signed up at it yet: neither
  // seeking nor nameable, so the student-proposed fact stands alone.
  return "Student proposed";
}

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
      variant="outline"
    >
      Remove
    </Button>
  );
}

/**
 * A fixed, small, decision-oriented set: no column picker, no card mode. Every
 * column is a field `listMyBookmarksAs` already returns, and that projection
 * re-checks visibility on read, so nothing here is disclosed that the viewer
 * could not open. `enableHiding: false` throughout is what removes the picker.
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
  {
    accessorFn: (row) => programLabel(row) ?? undefined,
    cell: ({ row }) => programLabel(row.original) ?? "-",
    enableHiding: false,
    header: "Program",
    id: "program",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.status,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    enableHiding: false,
    header: "Status",
    id: "status",
  },
  {
    accessorFn: (row) => row.acceptingApplicants,
    // "Yes" rather than a dash, as on /projects: under this header a dash
    // would read as "no".
    cell: ({ row }) =>
      row.original.acceptingApplicants ? (
        "Yes"
      ) : (
        <ApplicantsBadge acceptingApplicants={false} />
      ),
    enableHiding: false,
    header: "Accepting applicants",
    id: "accepting",
    sortingFn: "basic",
  },
  {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => row.original.teamsSupported,
    enableHiding: false,
    header: "Teams supported",
    id: "teams",
    // Numeric, not text: the locale-compare default would put "10" before "2".
    sortingFn: "basic",
  },
  {
    accessorFn: (row) => row.requiresNdaIp,
    cell: ({ row }) =>
      row.original.requiresNdaIp ? (
        <Badge variant="outline">Required</Badge>
      ) : (
        "-"
      ),
    enableHiding: false,
    header: "NDA/IP required",
    id: "nda",
    sortingFn: "basic",
  },
  {
    // Seeking a mentor first, then student proposed, then the rest, so the
    // first header click surfaces what a prospective mentor is looking for.
    accessorFn: (row) => {
      if (row.seekingMentor) {
        return 2;
      }
      return row.studentProposed ? 1 : 0;
    },
    cell: ({ row }) => originLabel(row.original) ?? "-",
    enableHiding: false,
    header: "Origin",
    id: "origin",
    sortingFn: "basic",
  },
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

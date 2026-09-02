import { Link } from "@tanstack/react-router";
import { defineAdminColumns } from "#/components/admin-data-table";
import { projectImageSrc } from "#/lib/project-image";
import { stripMarkdown } from "#/lib/strip-markdown";
import type { SortState } from "#/lib/table-state";
import type { searchProjects } from "#/server/search";
import { BookmarkToggle } from "./bookmark-set";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { programLabel } from "./project-card";
import { Badge } from "./ui/badge";

/**
 * One row of the public listing, as `searchProjects` returns it. Both modes
 * render this shape: the card reads a subset of it, the table all of it.
 */
export type ProjectListRow = Awaited<
  ReturnType<typeof searchProjects>
>["rows"][number];

export const PROJECT_TABLE_DEFAULT_SORT: SortState = {
  desc: true,
  id: "updatedAt",
};

/**
 * A prose field in a table cell. The fixed width plus the clamp is what keeps
 * one long description from setting the row height for the whole table.
 */
function Prose({ text }: { text: string | null }) {
  if (!text) {
    return "-";
  }
  return <div className="line-clamp-3 max-w-xs">{stripMarkdown(text)}</div>;
}

type ProseField = {
  [K in keyof ProjectListRow]: ProjectListRow[K] extends string | null
    ? K
    : never;
}[keyof ProjectListRow];

/**
 * A hidden-by-default prose column. No `accessorFn` and `enableSorting:
 * false`: without an accessor TanStack already refuses to sort, but
 * `useAdminTableState` reads the flag, and the flag is what keeps
 * `?sort=description` out of the sortable set.
 */
function proseColumn<TId extends string>(
  id: TId,
  header: string,
  field: ProseField
) {
  return {
    cell: ({ row }: { row: { original: ProjectListRow } }) => (
      <Prose text={row.original[field]} />
    ),
    defaultHidden: true,
    enableSorting: false,
    header,
    id,
  } as const;
}

/**
 * The public listing's table mode. Every column is a field
 * `projectDetailView` returns to an anonymous viewer; nothing here makes a
 * new field public. The list lives outside the route so
 * `project-table-columns.test.tsx` can render it through `AdminDataTable`.
 *
 */
export const PROJECT_TABLE_COLUMNS = defineAdminColumns<ProjectListRow>()([
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
        {/*
          Inside the title cell rather than a column of its own: the toggle
          renders nothing for an anonymous viewer, and an empty column would
          be noise on the page they hit first.
        */}
        <BookmarkToggle className="ml-auto" projectId={row.original.id} />
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
    header: "Program",
    id: "program",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.categories ?? undefined,
    cell: ({ row }) => row.original.categories ?? "-",
    enableSorting: false,
    header: "Categories",
    id: "categories",
  },
  {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => row.original.teamsSupported,
    header: "Teams supported",
    id: "teams",
    // Numeric, not text: the locale-compare default would compare String(n),
    // where "10" sorts before "2".
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
    header: "NDA/IP required",
    id: "nda",
    // Boolean, not text, for the same reason as the Teams column.
    sortingFn: "basic",
  },
  {
    accessorFn: (row) => row.contactName ?? undefined,
    cell: ({ row }) => row.original.contactName ?? "-",
    header: "Contact name",
    id: "contactName",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.contactEmail ?? undefined,
    cell: ({ row }) =>
      row.original.contactEmail ? (
        <a
          className="text-brand hover:underline"
          href={`mailto:${row.original.contactEmail}`}
        >
          {row.original.contactEmail}
        </a>
      ) : (
        "-"
      ),
    header: "Contact email",
    id: "contactEmail",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    header: "Updated",
    id: "updatedAt",
    sortingFn: "datetime",
  },
  proseColumn("description", "Description", "description"),
  proseColumn("problemStatement", "Problem statement", "problemStatement"),
  proseColumn("objectives", "Objectives", "objectives"),
  proseColumn("minQualifications", "Min qualifications", "minQualifications"),
  proseColumn(
    "prefQualifications",
    "Pref qualifications",
    "prefQualifications"
  ),
  proseColumn(
    "licenseRestrictions",
    "License restrictions",
    "licenseRestrictions"
  ),
  {
    accessorFn: (row) => row.url ?? undefined,
    cell: ({ row }) =>
      row.original.url ? (
        <a
          className="text-brand hover:underline"
          href={row.original.url}
          rel="noreferrer"
          target="_blank"
        >
          {row.original.url}
        </a>
      ) : (
        "-"
      ),
    defaultHidden: true,
    header: "URL",
    id: "url",
    sortUndefined: "last",
  },
]);

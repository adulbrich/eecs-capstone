import { Link } from "@tanstack/react-router";
import type { CellContext } from "@tanstack/react-table";
import {
  type AdminTableFeatures,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { projectImageSrc } from "#/lib/project-image";
import { stripMarkdown } from "#/lib/strip-markdown";
import type { SortState } from "#/lib/table-state";
import type { searchProjects } from "#/server/search";
import { BookmarkToggle } from "./bookmark-set";
import { CategoryChip } from "./category-chip";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { projectSummaryColumns } from "./project-summary-columns";

/**
 * One row of the public listing, as `searchProjects` returns it. Both modes
 * render this shape: the card reads a subset of it, the table all of it.
 */
export type ProjectListRow = Awaited<
  ReturnType<typeof searchProjects>
>["rows"][number];

/**
 * Required by `useAdminTable` and inert: every column below is
 * `enableSorting: false` since #475, so `parseSort` returns this whatever the
 * URL says and the table renders the order `searchProjects` returned. It used
 * to be a real `updatedAt desc`, which is how a reader who picked
 * "Recommended for you" and switched to table view got recommendation
 * selected rows in Updated order. `/my/items` passes an inert one for the
 * same reason. [ADR-0030](../../docs/adr/0030-one-ordering-control-on-the-public-listing.md).
 */
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
  return (
    <div className="line-clamp-3 max-w-xs md:whitespace-normal">
      {stripMarkdown(text)}
    </div>
  );
}

/** The nullable text columns of a row: what a prose cell can be pointed at. */
type TextField = {
  [K in keyof ProjectListRow]: ProjectListRow[K] extends string | null
    ? null extends ProjectListRow[K]
      ? K
      : never
    : never;
}[keyof ProjectListRow];

/**
 * A hidden-by-default prose column, with the field name as its id. No
 * `accessorFn` and `enableSorting: false`: without an accessor TanStack
 * already refuses to sort, but `useAdminTableState` reads the flag, and the
 * flag is what keeps `?sort=description` out of the sortable set.
 */
function proseColumn(field: TextField, header: string) {
  return {
    cell: ({
      row,
    }: CellContext<AdminTableFeatures, ProjectListRow, unknown>) => (
      <Prose text={row.original[field]} />
    ),
    defaultHidden: true,
    enableSorting: false,
    header,
    id: field,
  };
}

const shared = projectSummaryColumns<ProjectListRow>();

/**
 * The public listing's table mode. Every column is a field
 * `projectDetailView` returns to an anonymous viewer; nothing here makes a
 * new field public. The list lives outside the route so
 * `project-table-columns.test.tsx` can render it through `AdminDataTable`.
 */
export const PROJECT_TABLE_COLUMNS = defineAdminColumns<ProjectListRow>()([
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
          Inside the title cell rather than a column of its own: the toggle
          renders nothing for an anonymous viewer, and an empty column would
          be noise on the page they hit first.
        */}
        <BookmarkToggle className="ml-auto" projectId={row.original.id} />
      </div>
    ),
    cardHeader: true,
    enableHiding: false,
    enableSorting: false,
    header: "Title",
    id: "title",
  },
  // Spread rather than changed at the source: `projectSummaryColumns` is
  // shared with `bookmark-table-columns.tsx`, whose table still sorts.
  { ...shared.program, enableSorting: false },
  {
    cell: ({ row }) =>
      row.original.categories.length === 0 ? (
        "-"
      ) : (
        <div className="flex min-w-64 flex-wrap gap-1">
          {row.original.categories.map((category) => (
            <CategoryChip category={category} compact key={category.id} />
          ))}
        </div>
      ),
    enableSorting: false,
    header: "Categories",
    id: "categories",
  },
  { ...shared.teams, enableSorting: false },
  shared.badges,
  {
    accessorFn: (row) => row.contactName ?? undefined,
    cell: ({ row }) => row.original.contactName ?? "-",
    enableSorting: false,
    header: "Contact name",
    id: "contactName",
  },
  {
    accessorFn: (row) => row.contactEmail ?? undefined,
    cell: ({ row }) =>
      row.original.contactEmail ? (
        <a
          className="text-brand-dark hover:underline"
          href={`mailto:${row.original.contactEmail}`}
        >
          {row.original.contactEmail}
        </a>
      ) : (
        "-"
      ),
    // Hidden by default since 2026-09-02: eight visible columns overflowed
    // 1280px, and the address is the one a reader wants least while scanning.
    defaultHidden: true,
    enableSorting: false,
    header: "Contact email",
    id: "contactEmail",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    enableSorting: false,
    header: "Updated",
    id: "updatedAt",
  },
  proseColumn("description", "Description"),
  proseColumn("problemStatement", "Problem statement"),
  proseColumn("objectives", "Objectives"),
  proseColumn("minQualifications", "Min qualifications"),
  proseColumn("prefQualifications", "Pref qualifications"),
  proseColumn("licenseRestrictions", "License restrictions"),
  {
    accessorFn: (row) => row.url ?? undefined,
    cell: ({ row }) =>
      row.original.url ? (
        <a
          className="text-brand-dark hover:underline"
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
    enableSorting: false,
    header: "URL",
    id: "url",
  },
]);

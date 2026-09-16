import type { AdminColumn } from "#/components/admin-data-table";
import { ProjectBadges } from "./project-badges";
import { programLabel } from "./project-card";
import { TeamFullBadge } from "./team-full-badge";

/** The fields of `projectSummarySelect` these columns read. */
export interface ProjectSummaryRow {
  acceptingApplicants: boolean;
  programCourseId: string | null;
  programCourseName: string | null;
  requiresNdaIp: boolean;
  studentProposed: boolean;
  teamsSupported: number;
}

/**
 * The columns `/projects` and `/my/bookmarks` render the same way, built once
 * per row type. A factory rather than shared consts because a column's `cell`
 * is typed on the row, and the two tables have different rows that both
 * extend this one. `satisfies` rather than an annotation, per QUIRKS: an
 * annotation would erase the accessor's return type that
 * `defineAdminColumns` checks, while `satisfies` still types every `row`
 * below. Only `id` needs `as const`, so the diagnostic can name the column.
 * Callers spread and override (`enableHiding`, `header`) rather than passing
 * options in.
 */
export function projectSummaryColumns<Row extends ProjectSummaryRow>() {
  const program = {
    accessorFn: (row) => programLabel(row) ?? undefined,
    cell: ({ row }) => programLabel(row.original) ?? "-",
    header: "Program",
    id: "program" as const,
    sortUndefined: "last",
  } satisfies AdminColumn<Row>;

  const teams = {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => row.original.teamsSupported,
    header: "Teams supported",
    id: "teams" as const,
    // Numeric, not text: the locale-compare default would compare String(n),
    // where "10" sorts before "2".
    sortFn: "basic",
  } satisfies AdminColumn<Row>;

  /**
   * The card's badge row, in a cell. It replaced two columns that each spent a
   * header and a cell's width on a fact that is usually absent: "Openings"
   * read "Yes" on nearly every row and "NDA/IP required" a dash, so between
   * them they carried one badge occasionally and filler the rest of the time,
   * on a table that already hides Contact email because eight columns
   * overflowed 1280px (#434).
   *
   * `ProjectBadges` renders it, with the team badge as `children` exactly as
   * `projects/$projectId.tsx` does, so no surface computes a badge its own
   * way. "Student proposed" is in because the card shows it and no table did;
   * without it this would be the card's row minus one.
   *
   * Unsortable, like Categories. The `acceptingOnly`, `studentProposedOnly`
   * and `requiresNdaOnly` switches already narrow on each fact separately, and
   * a rank over a cluster of badges is an order nobody asked for.
   */
  const badges = {
    cell: ({ row }) => {
      const { acceptingApplicants, requiresNdaIp, studentProposed } =
        row.original;
      // The dash is this cell's own, not `ProjectBadges`'s. That component
      // returns null only when it has no children either, and `children` here
      // is always a `TeamFullBadge` element, which is truthy even on the open
      // team it renders nothing for. Without this it would emit an empty flex
      // row where every other empty cell in these tables shows a dash.
      if (acceptingApplicants && !(studentProposed || requiresNdaIp)) {
        return "-";
      }
      return (
        <ProjectBadges
          className="min-w-64"
          requiresNdaIp={requiresNdaIp}
          studentProposed={studentProposed}
        >
          <TeamFullBadge acceptingApplicants={acceptingApplicants} />
        </ProjectBadges>
      );
    },
    enableSorting: false,
    header: "Badges",
    id: "badges" as const,
  } satisfies AdminColumn<Row>;

  // No mentorship column: the two badges stay on the card and the detail
  // page, and the public listing filters on them instead (#336).
  return { badges, program, teams };
}

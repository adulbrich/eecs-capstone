import type { AdminColumn } from "#/components/admin-data-table";
import { ApplicantsBadge } from "./applicants-badge";
import { programLabel } from "./project-card";
import { Badge } from "./ui/badge";

/** The fields of `projectSummarySelect` these columns read. */
export interface ProjectSummaryRow {
  acceptingApplicants: boolean;
  programCourseId: string | null;
  programCourseName: string | null;
  requiresNdaIp: boolean;
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

  const accepting = {
    accessorFn: (row) => row.acceptingApplicants,
    // "Yes" rather than the dash the NDA column uses for its ordinary case:
    // under this header a dash would read as "no", the opposite of the truth.
    cell: ({ row }) =>
      row.original.acceptingApplicants ? (
        "Yes"
      ) : (
        <ApplicantsBadge acceptingApplicants={false} />
      ),
    header: "Accepting applicants",
    id: "accepting" as const,
    // Boolean, not text: see the Teams column.
    sortFn: "basic",
  } satisfies AdminColumn<Row>;

  const nda = {
    accessorFn: (row) => row.requiresNdaIp,
    cell: ({ row }) =>
      row.original.requiresNdaIp ? (
        <Badge variant="outline">Required</Badge>
      ) : (
        "-"
      ),
    header: "NDA/IP required",
    id: "nda" as const,
    sortFn: "basic",
  } satisfies AdminColumn<Row>;

  // No mentorship column: the two badges stay on the card and the detail
  // page, and the public listing filters on them instead (#336).
  return { accepting, nda, program, teams };
}

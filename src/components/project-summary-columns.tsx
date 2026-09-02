import type { CellContext } from "@tanstack/react-table";
import type { AdminColumn } from "#/components/admin-data-table";
import { ApplicantsBadge } from "./applicants-badge";
import { MentorshipBadges } from "./mentorship-badges";
import { programLabel } from "./project-card";
import { Badge } from "./ui/badge";

/** The fields of `projectSummarySelect` these columns read. */
export interface ProjectSummaryRow {
  acceptingApplicants: boolean;
  mentorName: string | null;
  programCourseId: string | null;
  programCourseName: string | null;
  requiresNdaIp: boolean;
  seekingMentor: boolean;
  studentProposed: boolean;
  teamsSupported: number;
}

/**
 * The columns `/projects` and `/my/bookmarks` render the same way, built once
 * per row type. A factory rather than shared consts because a column's `cell`
 * is typed on the row, and the two tables have different rows that both
 * extend this one. `satisfies` rather than an annotation, per QUIRKS: an
 * annotation would erase the accessor's return type that
 * `defineAdminColumns` checks. Callers spread and override (`enableHiding`,
 * `header`) rather than passing options in.
 */
export function projectSummaryColumns<Row extends ProjectSummaryRow>() {
  const program = {
    accessorFn: (row: Row) => programLabel(row) ?? undefined,
    cell: ({ row }: CellContext<Row, unknown>) =>
      programLabel(row.original) ?? "-",
    header: "Program",
    id: "program" as const,
    sortUndefined: "last" as const,
  } satisfies AdminColumn<Row>;

  const teams = {
    accessorFn: (row: Row) => row.teamsSupported,
    cell: ({ row }: CellContext<Row, unknown>) => row.original.teamsSupported,
    header: "Teams supported",
    id: "teams" as const,
    // Numeric, not text: the locale-compare default would compare String(n),
    // where "10" sorts before "2".
    sortingFn: "basic" as const,
  } satisfies AdminColumn<Row>;

  const accepting = {
    accessorFn: (row: Row) => row.acceptingApplicants,
    // "Yes" rather than the dash the NDA column uses for its ordinary case:
    // under this header a dash would read as "no", the opposite of the truth.
    cell: ({ row }: CellContext<Row, unknown>) =>
      row.original.acceptingApplicants ? (
        "Yes"
      ) : (
        <ApplicantsBadge acceptingApplicants={false} />
      ),
    header: "Accepting applicants",
    id: "accepting" as const,
    // Boolean, not text: see the Teams column.
    sortingFn: "basic" as const,
  } satisfies AdminColumn<Row>;

  const nda = {
    accessorFn: (row: Row) => row.requiresNdaIp,
    cell: ({ row }: CellContext<Row, unknown>) =>
      row.original.requiresNdaIp ? (
        <Badge variant="outline">Required</Badge>
      ) : (
        "-"
      ),
    header: "NDA/IP required",
    id: "nda" as const,
    sortingFn: "basic" as const,
  } satisfies AdminColumn<Row>;

  const mentorship = {
    // Seeking a mentor ranks highest, then student proposed, then the rest.
    // TanStack starts a numeric column descending, so the first header click
    // puts the projects a prospective mentor is looking for at the top.
    accessorFn: (row: Row) => {
      if (row.seekingMentor) {
        return 2;
      }
      return row.studentProposed ? 1 : 0;
    },
    // Both of #75's public facts in one cell. Mentor state only means
    // anything on a student-proposed project, so a column of its own would
    // be blank on most rows; combined, blank honestly means "an ordinary
    // proposal" rather than looking like missing data.
    cell: ({ row }: CellContext<Row, unknown>) => {
      const { mentorName, seekingMentor, studentProposed } = row.original;
      if (!(studentProposed || seekingMentor || mentorName)) {
        return "-";
      }
      return (
        <div className="flex flex-col gap-1">
          <MentorshipBadges
            seekingMentor={seekingMentor}
            studentProposed={studentProposed}
          />
          {mentorName && <span className="text-sm">{mentorName}</span>}
        </div>
      );
    },
    header: "Mentorship",
    id: "mentorship" as const,
    sortingFn: "basic" as const,
  } satisfies AdminColumn<Row>;

  return { accepting, mentorship, nda, program, teams };
}

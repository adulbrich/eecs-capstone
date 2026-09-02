import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public mentorship state of a project, as badges.
 *
 * Two flags rather than the mentor's address because the address never
 * reaches a public payload. `seekingMentor` is derived on the server as
 * "student proposed with no address on file", which is what lets a project
 * whose mentor has not signed up yet show nothing rather than a false
 * "Seeking mentor". See #75.
 *
 * Rendered by the card, the detail page and the shared table column in
 * `project-summary-columns.tsx`, so no surface computes the badges its own
 * way.
 */
export function MentorshipBadges({
  className,
  seekingMentor,
  studentProposed,
}: {
  className?: string;
  seekingMentor: boolean;
  studentProposed: boolean;
}) {
  if (!(studentProposed || seekingMentor)) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {studentProposed && <Badge variant="outline">Student proposed</Badge>}
      {seekingMentor && (
        <Badge
          style={{
            backgroundColor: "var(--status-warning-bg)",
            color: "var(--status-warning)",
          }}
          variant="status"
        >
          Seeking mentor
        </Badge>
      )}
    </div>
  );
}

import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public marks of a project, as badges: student proposed, seeking a
 * mentor, running without one, and requiring an NDA or IP agreement (#372,
 * #373).
 *
 * Derived flags rather than the mentor's address or the stored state,
 * because neither reaches a public payload. `seekingMentor` is derived on
 * the server as "staff marked it as seeking and no address is on file",
 * which is what lets a project whose mentor has not signed up yet show
 * nothing rather than a false "Seeking mentor"; `noMentorNeeded` is the
 * `none` state, which the writer refuses beside an address, so the two
 * never both show. The flags are independent of `studentProposed` since
 * #304: any badge can show alone. See #75.
 *
 * Rendered by the card and the detail page, so no surface computes the
 * badges its own way. No table shows the mentorship badges; the agreement
 * flag is a badge column in the public and bookmark tables and a CSV field
 * on the staff route. Both listings filter on the same facts (#336, #372,
 * #373).
 */
export function ProjectBadges({
  className,
  noMentorNeeded,
  requiresNdaIp,
  seekingMentor,
  studentProposed,
}: {
  className?: string;
  noMentorNeeded: boolean;
  requiresNdaIp: boolean;
  seekingMentor: boolean;
  studentProposed: boolean;
}) {
  if (!(studentProposed || seekingMentor || noMentorNeeded || requiresNdaIp)) {
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
      {noMentorNeeded && <Badge variant="outline">No mentor needed</Badge>}
      {requiresNdaIp && <Badge variant="outline">NDA/IP required</Badge>}
    </div>
  );
}

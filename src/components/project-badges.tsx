import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public marks of a project, as badges: student proposed, seeking a
 * mentor, and requiring an NDA or IP agreement (#372).
 *
 * Two flags rather than the mentor's address because the address never
 * reaches a public payload. `seekingMentor` is derived on the server as
 * "staff marked it as looking for a mentor and no address is on file", which
 * is what lets a project whose mentor has not signed up yet show nothing
 * rather than a false "Seeking mentor". The flags are independent since
 * #304: any badge can show alone. See #75.
 *
 * Rendered by the card and the detail page, so no surface computes the
 * badges its own way. The tables show no badges (the agreement flag is a
 * plain column there); both listings filter on the same facts (#336, #372).
 */
export function ProjectBadges({
  className,
  requiresNdaIp,
  seekingMentor,
  studentProposed,
}: {
  className?: string;
  requiresNdaIp: boolean;
  seekingMentor: boolean;
  studentProposed: boolean;
}) {
  if (!(studentProposed || seekingMentor || requiresNdaIp)) {
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
      {requiresNdaIp && <Badge variant="outline">NDA/IP required</Badge>}
    </div>
  );
}

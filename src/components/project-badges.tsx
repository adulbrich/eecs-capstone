import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public marks of a project, as badges: student proposed and requiring
 * an NDA or IP agreement (#372). Nothing about mentorship since #402: the
 * mentor is an address staff record, never public, with no state beside it
 * that a badge could show.
 *
 * Rendered by the card and the detail page, so no surface computes the
 * badges its own way. The agreement flag is also a badge column in the
 * public and bookmark tables and a CSV field on the staff route. Both
 * listings filter on the same facts (#336, #372).
 */
export function ProjectBadges({
  className,
  requiresNdaIp,
  studentProposed,
}: {
  className?: string;
  requiresNdaIp: boolean;
  studentProposed: boolean;
}) {
  if (!(studentProposed || requiresNdaIp)) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {studentProposed && <Badge variant="outline">Student proposed</Badge>}
      {requiresNdaIp && <Badge variant="outline">NDA/IP required</Badge>}
    </div>
  );
}

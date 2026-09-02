import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The one badge for a project that is published but not taking applicants.
 * Nothing renders for the open case: every listed project accepts by default,
 * so a positive badge on every card would be noise and the closed one is the
 * exception a student needs to see before investing in an application.
 *
 * Error tokens rather than warning: this is a hard stop for an applicant,
 * not a caveat, and #72 asks for a clear badge rather than a subtle one.
 */
export function ApplicantsBadge({
  acceptingApplicants,
  className,
}: {
  acceptingApplicants: boolean;
  className?: string;
}) {
  if (acceptingApplicants) {
    return null;
  }
  return (
    <Badge
      className={cn(className)}
      style={{
        backgroundColor: "var(--status-error-bg)",
        color: "var(--status-error)",
      }}
      variant="status"
    >
      Not accepting applicants
    </Badge>
  );
}

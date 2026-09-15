import { Badge } from "./ui/badge";

/**
 * The one badge for a published project whose team has no room left.
 *
 * Nothing renders for the open case, and the listing defaults to hiding the
 * full ones, so a positive badge would sit on very nearly every card and say
 * nothing. The full case is the exception a student needs to see before
 * investing in a project they cannot join.
 *
 * Error tokens rather than warning: this is a hard stop for a student reading
 * the card, not a caveat, and #72 asks for a clear badge rather than a subtle
 * one.
 *
 * The prop keeps the stored column's name (`projects.accepting_applicants`,
 * which is the inverse of what this badge shows) so the wire, the schema and
 * the component agree; the words a reader sees are the ones CONTEXT.md
 * sanctions.
 */
export function TeamFullBadge({
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
      className={className}
      style={{
        backgroundColor: "var(--status-error-bg)",
        color: "var(--status-error)",
      }}
      variant="status"
    >
      Team is full
    </Badge>
  );
}

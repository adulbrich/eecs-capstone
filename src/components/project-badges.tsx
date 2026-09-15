import type * as React from "react";
import { cn } from "#/lib/utils.ts";
import { Badge } from "./ui/badge";

/**
 * The public marks of a project, as badges: student proposed and requiring
 * an NDA or IP agreement (#372). Nothing about mentorship since #402: the
 * mentor is an address staff record, never public, with no state beside it
 * that a badge could show.
 *
 * Rendered by the card and the detail page, so no surface computes the
 * badges its own way. The detail page passes its status and team-full
 * badges as `children`, rendered before the marks, so the page has one
 * badge row under the title rather than two rows with two gaps (#400); the
 * card passes nothing and still renders nothing when no mark is set. The
 * agreement flag is also a badge column in the public and bookmark tables
 * and a CSV field on the staff route. Both listings filter on the same
 * facts (#336, #372).
 */
export function ProjectBadges({
  children,
  className,
  requiresNdaIp,
  studentProposed,
}: {
  children?: React.ReactNode;
  className?: string;
  requiresNdaIp: boolean;
  studentProposed: boolean;
}) {
  if (!(children || studentProposed || requiresNdaIp)) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {studentProposed && <Badge variant="outline">Student proposed</Badge>}
      {requiresNdaIp && <Badge variant="outline">NDA/IP required</Badge>}
    </div>
  );
}

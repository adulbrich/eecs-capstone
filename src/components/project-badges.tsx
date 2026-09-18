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
 * card passes nothing and still renders nothing when no mark is set.
 *
 * Since #434 the public and bookmark tables render this same row in their
 * Badges column, passing `TeamFullBadge` as `children` the way the detail page
 * does, in place of the two columns that used to spell two of these facts out
 * as text. So a caller that passes children must handle the empty case itself:
 * an element is truthy even when it renders nothing, so `children` alone keeps
 * this from returning null. The agreement flag is also a CSV field on the
 * staff route, and both listings filter on the same facts (#336, #372).
 */
export function ProjectBadges({
  children,
  className,
  requiresNdaIp,
  studentProposed,
  teamsSupported,
}: {
  children?: React.ReactNode;
  className?: string;
  requiresNdaIp: boolean;
  studentProposed: boolean;
  /**
   * How many teams the project can host (#468). Silent at one, which the
   * empty case below has to know about too: a badge on nearly every project
   * is the filler #434 deleted two columns to remove.
   *
   * Optional, and omitted on purpose by the two tables: they carry a Teams
   * supported column of their own, so passing it there would print the same
   * number twice in one row. The card and the detail page have no such
   * column, which is what this badge is for.
   */
  teamsSupported?: number;
}) {
  const manyTeams = (teamsSupported ?? 1) > 1;
  if (!(children || studentProposed || requiresNdaIp || manyTeams)) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
      {studentProposed && <Badge variant="outline">Student proposed</Badge>}
      {requiresNdaIp && <Badge variant="outline">NDA/IP required</Badge>}
      {/* A count, in the glossary's word for them. Last in the row because it
          is the weakest of the three marks: it says how much room there is,
          not what a reader would have to agree to. Always plural, because
          `manyTeams` is false at one and the badge is not rendered. */}
      {manyTeams && <Badge variant="outline">{teamsSupported} teams</Badge>}
    </div>
  );
}

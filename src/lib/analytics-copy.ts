// Copy the analytics dashboard derives from numbers. Pure, so the "not set"
// rule the issue asks for can be asserted without rendering a route.

export interface SlotsFigure {
  expectedTeams: number | null;
  expectedTeamsPrograms: { set: number; total: number };
  publishedTeamSlots: number;
  /**
   * Published projects in scope that run in more than one program (#462).
   * `teams_supported` is one number on the project, shared across its
   * programs, so such a project contributes all of it to every program it
   * runs in and the per program figures stop summing to the global one.
   * That is the intended reading, so the hint says it out loud rather than
   * leaving staff to find the discrepancy.
   */
  sharedProjects: number;
}

/**
 * The hint under "Published team slots". An unset expectation renders as not
 * set, never as a comparison against zero, and a partial denominator (some
 * programs set, some not) is named rather than passed off as the whole.
 */
export function slotsHint(figure: SlotsFigure): string {
  return [base(figure), sharedNote(figure.sharedProjects)]
    .filter(Boolean)
    .join("; ");
}

function base(figure: SlotsFigure): string {
  const { expectedTeams, expectedTeamsPrograms: p } = figure;
  if (expectedTeams === null) {
    return p.total > 1
      ? "Expected teams not set on any program"
      : "Expected teams not set on the program";
  }
  const gap = expectedTeams - figure.publishedTeamSlots;
  const verdict = gap > 0 ? `${gap} short` : "covered";
  if (p.set < p.total) {
    return `${expectedTeams} expected across ${p.set} of ${p.total} programs with a value set, ${verdict} against that`;
  }
  return `${expectedTeams} expected, ${verdict}`;
}

function sharedNote(shared: number): string {
  if (shared === 0) {
    return "";
  }
  const one = shared === 1;
  return `${shared} ${one ? "project runs" : "projects run"} in more than one program and ${one ? "counts" : "count"} in full under each`;
}

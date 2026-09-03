// Copy the analytics dashboard derives from numbers. Pure, so the "not set"
// rule the issue asks for can be asserted without rendering a route.

export interface SlotsFigure {
  expectedTeams: number | null;
  expectedTeamsPrograms: { set: number; total: number };
  publishedTeamSlots: number;
}

/**
 * The hint under "Published team slots". An unset expectation renders as not
 * set, never as a comparison against zero, and a partial denominator (some
 * programs set, some not) is named rather than passed off as the whole.
 */
export function slotsHint(figure: SlotsFigure): string {
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

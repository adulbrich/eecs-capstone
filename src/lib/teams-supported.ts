/**
 * The bounds on `projects.teams_supported`, in one place.
 *
 * Two writers since #468, the proposer's form and the staff panel's Programs
 * and teams section, and each of them clamps a number input on blur. Those
 * clamps were byte-for-byte copies of each other, which is two bounds to keep
 * in sync by hand on a field whose whole difficulty is that two parties set
 * it (ADR-0032). The zod schemas that guard both endpoints read the same two
 * numbers, so a change here reaches the wire and the database too.
 */
export const TEAMS_SUPPORTED_MIN = 1;
export const TEAMS_SUPPORTED_MAX = 5;

/**
 * A number input's value folded into the bounds, for an `onBlur`.
 *
 * Anything that is not a finite number becomes the minimum rather than
 * throwing: the input is `type="number"`, so an empty field reads as `NaN`
 * and a reader who cleared it meant to type something, not to break the form.
 */
export function clampTeamsSupported(value: number): number {
  if (!Number.isFinite(value) || value < TEAMS_SUPPORTED_MIN) {
    return TEAMS_SUPPORTED_MIN;
  }
  return value > TEAMS_SUPPORTED_MAX ? TEAMS_SUPPORTED_MAX : value;
}

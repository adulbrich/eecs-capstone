/**
 * Which columns a project edit may touch, and what changed between two
 * versions of one.
 *
 * Pure and client-safe so the rules below can be exercised without a database.
 * Asserting on `changedFields` used to cost a Postgres round trip and a Better
 * Auth sign-up, which is why the guard in the loop had a comment and no test.
 *
 * The order of the list is observable: it decides the order of `changedFields`,
 * which is stored on the edit log and rendered in the staff panel.
 */

export const PROJECT_EDITABLE_FIELDS = [
  "title",
  "description",
  "problemStatement",
  "objectives",
  "minQualifications",
  "prefQualifications",
  "url",
  "contactEmail",
  "contactName",
  "imageUrl",
  "licenseRestrictions",
  "programId",
  "notes",
  "proposerEmail",
  "proposerId",
  "teamsSupported",
] as const;

export function diffProjectFields(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): {
  changedFields: string[];
  newDiff: Record<string, unknown>;
  oldDiff: Record<string, unknown>;
} {
  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const field of PROJECT_EDITABLE_FIELDS) {
    // A field the viewer was not allowed to write never made it into `next`,
    // and `.set()` leaves it alone. Diffing it anyway would log a phantom
    // "changed to null" edit for a value that is still in the row.
    if (!(field in next)) {
      continue;
    }
    const oldVal = existing[field] ?? null;
    const newVal = next[field] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      oldDiff[field] = oldVal;
      newDiff[field] = newVal;
      changedFields.push(field);
    }
  }
  return { changedFields, newDiff, oldDiff };
}

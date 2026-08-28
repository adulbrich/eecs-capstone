/**
 * What changed between two versions of a row.
 *
 * Pure and client-safe so the rules below can be exercised without a database.
 * Asserting on `changedFields` used to cost a Postgres round trip and a Better
 * Auth sign-up, which is why the guard in the loop had a comment and no test.
 *
 * There is deliberately no list of editable fields here. The writer decides
 * which columns an edit may touch, and this reads that decision off the object
 * it produced. A hand-maintained list beside `buildProjectValues` is a second
 * thing to keep in step, and it did not stay in step: `isSponsored` and
 * `requiresNdaIp` were written but never named, so an edit that moved only one
 * of them diffed to nothing, and `updateProjectAs` returned `updated: false`
 * before the UPDATE ran. The form reported success and the change was gone.
 *
 * `next` is `Partial<T>` of the row rather than a loose record, so a key that
 * is not a column on `projects` fails to typecheck at the call site. That is
 * the guarantee the old list was reaching for, moved from a runtime skip to a
 * compile error.
 *
 * The order of `changedFields` is observable: it is stored on the edit log and
 * rendered in the staff panel. It is now the order `buildProjectValues` builds
 * its object in, because object key order is insertion order for string keys.
 * Reordering that literal is therefore a visible change, and the unit test
 * pinning the order is what makes it a loud one.
 */

export function diffRowFields<T extends Record<string, unknown>>(
  existing: T,
  next: Partial<T>
): {
  changedFields: string[];
  newDiff: Record<string, unknown>;
  oldDiff: Record<string, unknown>;
} {
  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const field of Object.keys(next)) {
    // A field the viewer was not allowed to write never made it into `next`,
    // and `.set()` leaves it alone. Iterating `next` rather than a fixed list
    // is what keeps a phantom "changed to null" out of the log for a value
    // that is still in the row.
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

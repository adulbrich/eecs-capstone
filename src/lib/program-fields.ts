/**
 * Shared copy for the staff program forms, the way `private-notes.ts` holds
 * the copy its four surfaces share.
 *
 * Not in `project-visibility.ts` beside `programLabel`, although both exist
 * so two surfaces cannot drift: that module's own header calls it the
 * authority for what leaves the server, and a form hint is neither a
 * visibility rule nor part of a payload.
 */

/**
 * What the Course ID field is for, told to staff at the point of entry.
 *
 * One constant because the create dialog on `/admin/programs` and the edit
 * page both need it and neither is the other's parent. The rule it states is
 * enforced by `PROGRAM_COURSE_ID_INDEX` (#472); before that it was
 * convention, and every production program already follows it.
 */
export const PROGRAM_COURSE_ID_HINT =
  "Identifies the program everywhere it is listed, so two sections of one course need distinct ids, as in CS46X-CORVALLIS and CS46X-ECAMPUS.";

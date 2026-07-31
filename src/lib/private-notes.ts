/**
 * One vocabulary for every private-notes surface, so a project form, a project
 * page, an inventory form and an inventory page can't drift into calling the
 * same idea "internal notes", "staff notes" and "private notes" on three
 * different screens.
 *
 * The label is shared; the audience line is not, because the audiences
 * genuinely differ. A project has a proposer who wrote the notes and must be
 * able to read them back. An inventory item has no proposer, so its notes
 * (locker codes, storage quirks, repair history) stay with staff.
 */
export const PRIVATE_NOTES_LABEL = "Private notes";

export const PRIVATE_NOTES_PROJECT_HINT =
  "Only visible to staff and the proposer. Never shown publicly.";

export const PRIVATE_NOTES_INVENTORY_HINT =
  "Only visible to staff, e.g. locker codes or storage location details. Never shown publicly.";

/**
 * Audience line for the project page's private panel, which bundles private
 * notes together with status history and comments. PRIVATE_NOTES_PROJECT_HINT
 * above describes the notes field alone, on the form where a proposer writes
 * them; this constant describes the whole read-back region, which both the
 * proposer and staff can view. It intentionally names both audiences instead
 * of using "you", since a staff viewer reading someone else's project is not
 * the owner the word "you" would imply.
 */
export const PRIVATE_PANEL_AUDIENCE_HINT =
  "Only visible to the proposer and program staff. Never shown publicly.";

/**
 * Audience line for the staff-only panels on both the project and the
 * inventory item page. Lives here with the other audience strings so all of
 * them stay in one place and keep the same voice; it names the two roles
 * explicitly because "staff" is this app's own shorthand, not a term a
 * proposer or student would necessarily map to instructors and admins.
 */
export const STAFF_PANEL_AUDIENCE_HINT =
  "Only visible to staff (instructors and admins). Never shown publicly.";

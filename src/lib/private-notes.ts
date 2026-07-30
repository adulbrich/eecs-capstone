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

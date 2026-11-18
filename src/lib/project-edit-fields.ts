import { FIELD_HEADINGS } from "./project-review-fields";

/**
 * What the project edit log's field names read as, for the staff panel's
 * values view and the proposer edit notice (#839). Sentence case, because
 * Title Case belongs to the two long forms alone (docs/UI-CONVENTIONS.md);
 * the prose fields take the project page's own headings, so the log and the
 * page use the same words.
 *
 * Every name a writer in `src/server/_internal/projects.ts` can put in
 * `changed_fields`. A name missing here reads as itself rather than failing,
 * because the log is history and an old row may name a column since removed.
 */
const PROJECT_EDIT_FIELD_LABEL: Record<string, string> = {
  ...FIELD_HEADINGS,
  url: "URL",
  contactName: "Contact name",
  contactEmail: "Contact email",
  imageUrl: "Image",
  requiresNdaIp: "Requires an NDA or IP agreement",
  isSponsored: "Sponsored",
  teamsSupported: "Teams",
  notes: "Private notes",
  proposerEmail: "Proposer email",
  proposerId: "Proposer account",
  studentProposed: "Student proposed",
  mentorEmail: "Mentor email",
  programs: "Programs",
  acceptingApplicants: "Accepting applicants",
};

export function projectEditFieldLabel(field: string): string {
  // Own keys only, so `constructor` or `toString` read as themselves rather
  // than as what `Object.prototype` holds under those names.
  return Object.hasOwn(PROJECT_EDIT_FIELD_LABEL, field)
    ? (PROJECT_EDIT_FIELD_LABEL[field] as string)
    : field;
}

/**
 * One stored value as the text a diff compares, empty when there is none.
 * The log's values are whatever the column held, through `jsonb`: a string,
 * a boolean, a number, null, or for `programs` an array of labels.
 */
export function editValueText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * One stored value as words, for the email. An empty string reads as empty
 * too, because the form writes one for a cleared URL or contact address.
 */
export function formatEditValue(value: unknown): string {
  return editValueText(value) || "(empty)";
}

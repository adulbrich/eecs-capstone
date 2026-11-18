import { PRIVATE_NOTES_FIELD_LABEL } from "./private-notes";
import { FIELD_LABELS } from "./project-review-fields";

/**
 * What the project edit log's field names read as, for the staff panel's
 * values view and the proposer edit notice (#839). The form's own labels
 * where the form has the field, so the log and the form use the same words;
 * the staff panel's writers' fields get Title Case to match.
 *
 * Every name a writer in `src/server/_internal/projects.ts` can put in
 * `changed_fields`. A name missing here reads as itself rather than failing,
 * because the log is history and an old row may name a column since removed.
 */
const PROJECT_EDIT_FIELD_LABEL: Record<string, string> = {
  ...FIELD_LABELS,
  url: "URL",
  contactName: "Contact Name",
  contactEmail: "Contact Email",
  imageUrl: "Image",
  requiresNdaIp: "Requires an NDA or IP Agreement",
  isSponsored: "Sponsored",
  teamsSupported: "Teams",
  notes: PRIVATE_NOTES_FIELD_LABEL,
  proposerEmail: "Proposer Email",
  proposerId: "Proposer Account",
  studentProposed: "Student Proposed",
  mentorEmail: "Mentor Email",
  programs: "Programs",
  acceptingApplicants: "Accepting Applicants",
};

export function projectEditFieldLabel(field: string): string {
  return PROJECT_EDIT_FIELD_LABEL[field] ?? field;
}

/**
 * One stored value as text. The log's values are whatever the column held,
 * through `jsonb`: a string, a boolean, a number, null, or for `programs` an
 * array of labels. An empty string reads as empty too, because the form
 * writes one for a cleared URL or contact address.
 */
export function formatEditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "(empty)";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "(empty)" : value.map(String).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

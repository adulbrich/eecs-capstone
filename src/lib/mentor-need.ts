import type { MentorNeed } from "./vocabularies";

/**
 * The three mentor states as staff read them in the Mentor section (#373).
 * A `Record` keyed by the union, as `PROJECT_STATUS_LABEL` is, so a fourth
 * state fails to compile rather than vanishing from the radio group.
 */
export const MENTOR_NEED_LABEL: Record<MentorNeed, string> = {
  unspecified: "Not decided",
  seeking: "Seeking a mentor",
  none: "No mentor needed",
};

/**
 * Why a mentorship save is refused, or null when it is not. "No mentor
 * needed" and a recorded address can never coexist; the message names the
 * half the reader has to change, which is the half they did not just set,
 * so it depends on the saved state and not only on the draft. One function
 * for the server, which throws it, and the Mentor section, which shows it
 * under the draft before Save is pressed, so the two cannot disagree.
 */
export function mentorNeedRefusal(
  saved: MentorNeed,
  next: MentorNeed,
  hasAddress: boolean
): string | null {
  if (next !== "none" || !hasAddress) {
    return null;
  }
  return saved === "none"
    ? "Clear No mentor needed before recording a mentor."
    : "Remove the mentor before marking No mentor needed.";
}

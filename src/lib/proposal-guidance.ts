// Proposal guidance that more than one audience needs to know. Kept here rather
// than inline so the rule the form states to a proposer and the rule the model
// edits against cannot quietly diverge.

/**
 * The scope bar for a capstone project. `project-form.tsx` states this to the
 * proposer in its own second-person voice above the form; the AI review system
 * prompt embeds this wording verbatim. Change one and change the other.
 */
export const PROPOSAL_SCOPE_RULE =
  "A capstone project should be scoped at roughly what a proposer would hand a single summer intern, and kept off the proposer's critical path.";

/**
 * What a term and a team are, for judging the rule above against a length.
 * The scope assessment prompt embeds this; the proposal form does not show
 * it, because the form states the intern rule and nothing more, on purpose.
 * If the form ever explains lengths to proposers, it reads from here (#61).
 */
export const TERM_CALIBRATION =
  "A team is three to five undergraduate students working part time alongside other courses, so a term of roughly ten weeks holds about what one intern does in a summer, and three terms holds about three times that with the overhead of a longer project.";

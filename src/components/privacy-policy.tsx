import { brand } from "#/lib/brand";
import { SupportEmailLink } from "./support-email-link";

/**
 * The privacy page's body. Static, in the repo, and only a developer changes
 * it. The account-closure paragraph and the deletion dialog in #84 promise
 * the same things and move together; docs/QUIRKS.md says why.
 */
export function PrivacyPolicy() {
  return (
    <article className="space-y-4">
      <h1 className="font-semibold text-2xl">Privacy</h1>
      <p>
        The {brand.institutionName} {brand.programName} application collects the
        information you give it in order to run the capstone program: to publish
        and review project proposals, to match projects with teams, and to track
        equipment lending. We do not sell it and we do not use it for anything
        else.
      </p>
      <p>
        <strong>What is public stays public.</strong> Published and archived
        projects, including their descriptions and any contact details typed
        into them, are readable by anyone and stay readable at their existing
        URLs. Do not put anything in a proposal you would not want published.
      </p>
      <p>
        <strong>You can close your account.</strong> Doing so removes your
        profile: your name, your email address, your affiliation, and your
        interests. It does not remove projects you proposed, which stay
        published and are re-attributed to "Deleted user", and it does not
        remove records of departmental equipment you borrowed, which are
        institutional property records. Closing an account cannot be undone, and
        a new account cannot be linked back to old projects.
      </p>
      <p>
        Questions about any of this go to <SupportEmailLink />.
      </p>
    </article>
  );
}

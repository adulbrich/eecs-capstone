import { brand } from "#/lib/brand";
import { SupportEmailLink } from "./support-email-link";

/**
 * The privacy page's body. Static, in the repo, and only a developer changes
 * it. The account-closure paragraph and the deletion dialog in #84 promise
 * the same things and move together, and the page-view paragraph moves with
 * the traffic writer (#591); docs/QUIRKS.md says why.
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
        <strong>Page views are counted, without cookies.</strong> When a public
        page is opened, such as a project or the project listing, we record the
        page, the site that linked to it, any filters or search words used on
        it, and the country, browser, operating system and kind of device it was
        opened from. Nothing is stored in your browser, and the record is never
        connected to your account, even when you are signed in. It does not
        include your IP address. Instead, the address and your browser details
        are combined with a random value that is replaced every day and then
        discarded, so page views can be grouped into visits within one day but
        never connected across days, by us or anyone else. Pages that require
        signing in are not counted. Separately, the servers keep ordinary
        request logs, which do include IP addresses, for 30 days.
      </p>
      <p>
        Questions about any of this go to <SupportEmailLink />.
      </p>
    </article>
  );
}

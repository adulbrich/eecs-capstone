import type { ProposerForEdit } from "#/server/_internal/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";

/**
 * Who a project belongs to, and whether that person has an account.
 *
 * A project whose proposer never signed up stays unlinked, and an unlinked
 * proposer gets no "My projects" entry, no status notifications and no review
 * emails (see `docs/QUIRKS.md`, "Projects are claimed only by a verified
 * address"). Without this, the only signal was an address that looked the
 * same either way.
 *
 * Read-only on purpose. `ProposerPicker` owns changing the link; this owns
 * saying what it currently is, and both the detail page and the edit form show
 * the same thing rather than rendering the rule twice.
 */
export function ProposerSummary({ proposer }: { proposer: ProposerForEdit }) {
  return (
    <AccountLinkSummary
      accountLinked={proposer.accountLinked}
      accountName={proposer.accountName}
      email={proposer.email}
      label="Proposer"
      unlinkedHint="Links automatically when they sign up with this address."
    />
  );
}

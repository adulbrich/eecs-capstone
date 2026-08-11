import type { ProposerForEdit } from "#/server/_internal/projects-queries";

/**
 * Who a project belongs to, and whether that person has an account.
 *
 * The linked/unlinked distinction is the part staff actually need. A project
 * whose proposer never signed up stays unlinked, and an unlinked proposer gets
 * no "My projects" entry, no status notifications and no review emails (see
 * `docs/QUIRKS.md`, "Projects are claimed only by a verified address"). Without
 * this, the only signal was an address that looked the same either way.
 *
 * Read-only on purpose. `ProposerPicker` owns changing the link; this owns
 * saying what it currently is, and both the detail page and the edit form show
 * the same thing rather than rendering the rule twice.
 */
export function ProposerSummary({ proposer }: { proposer: ProposerForEdit }) {
  const { accountLinked, accountName, email } = proposer;

  if (!email) {
    return (
      <p className="text-muted-foreground text-sm">
        <span className="font-medium text-foreground">Proposer:</span> None on
        file
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {accountLinked && accountName && (
          <span className="font-medium text-sm">{accountName}</span>
        )}
        <span
          className="inline-flex items-center rounded px-2 py-0.5 font-medium text-xs"
          style={
            accountLinked
              ? {
                  background: "var(--status-success-bg)",
                  color: "var(--status-success)",
                }
              : {
                  background: "var(--status-warning-bg)",
                  color: "var(--status-warning)",
                }
          }
        >
          {accountLinked ? "Account linked" : "No account yet"}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">{email}</p>
      {!accountLinked && (
        <p className="text-muted-foreground text-xs">
          Links automatically when they sign up with this address.
        </p>
      )}
    </div>
  );
}

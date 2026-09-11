/**
 * An address on a project and whether that person has an account, in the
 * shape both the Proposer and the Mentorship sections of the staff panel use.
 *
 * The linked/unlinked distinction is the part staff actually need: an address
 * that looks the same either way is no signal. `ProposerSummary` and the
 * mentor block render this rather than the pill twice (#304).
 */
export function AccountLinkSummary({
  accountLinked,
  accountName,
  email,
  label,
  unlinkedHint,
}: {
  accountLinked: boolean;
  accountName: string | null;
  email: string | null;
  /** The role the address plays on the project: "Proposer", "Mentor". */
  label: string;
  /** What an unlinked address means for this role, one sentence. */
  unlinkedHint: string;
}) {
  if (!email) {
    return (
      <p className="text-muted-foreground text-sm">
        <span className="font-medium text-foreground">{label}:</span> None on
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
        <p className="text-muted-foreground text-xs">{unlinkedHint}</p>
      )}
    </div>
  );
}

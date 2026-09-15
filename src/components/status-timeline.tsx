import { LocalTime } from "./local-time";
import { StatusBadge } from "./status-badge";

interface HistoryRow {
  changedByEmail: string;
  /**
   * `null` only defensively, the way `inventory-lifecycle-panel.tsx` takes it:
   * `getProjectAs` joins `user` on a `notNull` column with `onDelete:
   * "restrict"`, and ADR 0008 scrubs a deleted account's name to "Deleted
   * user" rather than nulling it, so `changedByEmail` is a fallback the server
   * has no way to reach.
   */
  changedByName: string | null;
  comment: string | null;
  createdAt: Date | string;
  id: string;
  newStatus: string;
  oldStatus: string | null;
}

export function StatusTimeline({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No status changes yet.</p>
    );
  }
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li className="border-border border-l-2 pl-3" key={r.id}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {r.oldStatus ? (
              <StatusBadge status={r.oldStatus} />
            ) : (
              <span className="text-muted-foreground text-xs">created</span>
            )}
            <span className="text-muted-foreground">→</span>
            <StatusBadge status={r.newStatus} />
            {/* Beside the timestamp, in the same wrapping row, matching the
                inventory item history. The proposer sees it too: they are
                already shown every staff author's name on the comments above,
                and a "changes requested" they cannot attribute is one they
                cannot answer. */}
            <span className="text-muted-foreground text-xs">
              by {r.changedByName ?? r.changedByEmail}
            </span>
            <span className="text-muted-foreground text-xs">
              <LocalTime value={r.createdAt} />
            </span>
          </div>
          {r.comment && (
            <p className="mt-1 whitespace-pre-wrap text-sm">{r.comment}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

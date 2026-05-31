import { StatusBadge } from "./status-badge";

interface HistoryRow {
  changedBy: string;
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
            <span className="text-muted-foreground text-xs">
              {new Date(r.createdAt).toLocaleString()}
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

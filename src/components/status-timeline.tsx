import { StatusBadge } from "./status-badge";

type HistoryRow = {
  id: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  comment: string | null;
  createdAt: Date | string;
};

export function StatusTimeline({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No status changes yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-neutral-300 pl-3">
          <div className="flex items-center gap-2 text-sm">
            {r.oldStatus ? (
              <StatusBadge status={r.oldStatus} />
            ) : (
              <span className="text-xs text-neutral-500">created</span>
            )}
            <span>to</span>
            <StatusBadge status={r.newStatus} />
            <span className="text-xs text-neutral-500">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </div>
          {r.comment && (
            <p className="mt-1 text-sm text-neutral-700 whitespace-pre-wrap">
              {r.comment}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

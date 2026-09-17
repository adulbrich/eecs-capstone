import { LocalTime } from "./local-time";

/**
 * The rows either edit log renders.
 *
 * Both server functions select these four and `editorId`, and nothing else:
 * their `oldValues` and `newValues` hold the before and after of every
 * changed field, notes included, and nothing renders them, so neither
 * payload carries them (#467).
 */
export interface EditLogEntry {
  changedFields: string[];
  createdAt: Date | string;
  editorName: string;
  id: string;
}

/**
 * Who changed which fields, and when. Shared by the project staff panel and
 * the inventory one, which rendered the same nineteen lines of markup twice.
 *
 * The editor is named, on both, the way the status history beside either log
 * already names the person who moved the status. Both server functions join
 * `user`, and an account deleted since reads "Deleted user" rather than
 * dropping the row: ADR-0008 scrubs the name and leaves the account.
 *
 * `editorId` stays in both payloads and is deliberately not rendered: the
 * name is the answer to "who changed this", and an id prefix beside it was
 * never the readable half. Nothing forces its removal and
 * `inventory.integration.test.ts` reads it, so #467 left it alone.
 *
 * `error` separates "this item has no edits" from "the log could not be
 * loaded", which an empty list alone cannot say.
 */
export function EditLogList({
  error,
  rows,
}: {
  error?: boolean;
  rows: EditLogEntry[];
}) {
  if (error) {
    return (
      <p className="text-muted-foreground text-sm">
        The edit log could not be loaded.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No edits yet.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li className="border-border border-l-2 pl-3" key={row.id}>
          <div className="text-muted-foreground text-xs">
            {row.editorName} at <LocalTime value={row.createdAt} />
          </div>
          <div className="text-xs">Changed: {row.changedFields.join(", ")}</div>
        </li>
      ))}
    </ul>
  );
}

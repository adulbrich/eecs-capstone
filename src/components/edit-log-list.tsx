import { LocalTime } from "./local-time";

/**
 * The rows either edit log renders.
 *
 * `listProjectEditLog` returns more than this and neither panel shows the
 * rest; `listInventoryItemEditLog` selects exactly these four, deliberately,
 * because its `oldValues` carry notes, serial and location.
 */
export interface EditLogEntry {
  changedFields: string[];
  createdAt: Date | string;
  editorId: string;
  id: string;
}

/**
 * Who changed which fields, and when. Shared by the project staff panel and
 * the inventory one, which rendered the same nineteen lines of markup twice.
 *
 * The editor is an id prefix rather than a name, on both. Neither server
 * function joins `user`, and adding a name belongs on both logs at once.
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
            {row.editorId.slice(0, 8)} at <LocalTime value={row.createdAt} />
          </div>
          <div className="text-xs">Changed: {row.changedFields.join(", ")}</div>
        </li>
      ))}
    </ul>
  );
}

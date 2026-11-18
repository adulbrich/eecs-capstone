import { type QueryKey, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  formatEditValue,
  projectEditFieldLabel,
} from "#/lib/project-edit-fields";
import { LocalTime } from "./local-time";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";

/**
 * The rows either edit log renders.
 *
 * Both server functions select these four and `editorId`, and nothing else:
 * their `oldValues` and `newValues` hold the before and after of every
 * changed field, notes and whole markdown fields included, so neither list
 * carries them (#467). The project panel loads one row's values when staff
 * open it (#839), through `values` below; the item panel has no such read.
 */
export interface EditLogEntry {
  changedFields: string[];
  createdAt: Date | string;
  editorName: string;
  id: string;
}

/** One row's before and after, as `getProjectEditLogValues` returns them. */
export interface EditLogValues {
  changedFields: string[];
  newValues: Record<string, unknown>;
  oldValues: Record<string, unknown>;
}

/**
 * How a log loads one row's values, when it can. The caller owns the key, so
 * the project panel's reads stay under `staffProjectKeys`.
 */
export interface EditLogValuesSource {
  load: (id: string) => Promise<EditLogValues>;
  queryKey: (id: string) => QueryKey;
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
 *
 * With `values`, each row gets a Show values button that loads that row's
 * before and after on demand (#839).
 */
export function EditLogList({
  error,
  rows,
  values,
}: {
  error?: boolean;
  rows: EditLogEntry[];
  values?: EditLogValuesSource;
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
          {values && <RowValues id={row.id} source={values} />}
        </li>
      ))}
    </ul>
  );
}

function RowValues({
  id,
  source,
}: {
  id: string;
  source: EditLogValuesSource;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <>
      <Button
        aria-controls={open ? detailId : undefined}
        aria-expanded={open}
        className="text-xs"
        onClick={() => setOpen((o) => !o)}
        size="bare"
        type="button"
        variant="link"
      >
        {open ? "Hide values" : "Show values"}
      </Button>
      {open && <ValuesDetail id={detailId} rowId={id} source={source} />}
    </>
  );
}

function ValuesDetail({
  id,
  rowId,
  source,
}: {
  id: string;
  rowId: string;
  source: EditLogValuesSource;
}) {
  // A log row never changes once written, so one load is enough.
  const query = useQuery({
    queryFn: () => source.load(rowId),
    queryKey: source.queryKey(rowId),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (query.isPending) {
    return (
      <p className="text-muted-foreground mt-1 text-xs" id={id}>
        Loading values...
      </p>
    );
  }
  if (query.isError) {
    return (
      <FieldError
        id={id}
        message={errorMessage(query.error, "The values could not be loaded.")}
      />
    );
  }
  const { changedFields, newValues, oldValues } = query.data;
  return (
    <dl className="mt-1 space-y-2 text-xs" id={id}>
      {changedFields.map((field) => (
        <div key={field}>
          <dt className="font-medium">{projectEditFieldLabel(field)}</dt>
          <dd className="text-muted-foreground">
            Before: <ValueText value={oldValues[field]} />
          </dd>
          <dd>
            After: <ValueText value={newValues[field]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Line breaks kept, because a markdown field's paragraphs are the change, and
 * bounded so one long description does not push the rest of the panel away.
 */
function ValueText({ value }: { value: unknown }) {
  return (
    <span className="block max-h-40 overflow-y-auto break-words whitespace-pre-wrap">
      {formatEditValue(value)}
    </span>
  );
}

import { type QueryKey, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  editValueText,
  projectEditFieldLabel,
} from "#/lib/project-edit-fields";
import { diffText } from "#/lib/text-diff";
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
    <div className="mt-2 space-y-2" id={id}>
      {changedFields.map((field) => (
        <FieldDiff
          after={newValues[field]}
          before={oldValues[field]}
          key={field}
          label={projectEditFieldLabel(field)}
        />
      ))}
    </div>
  );
}

const LINE_STYLE = {
  added: {
    backgroundColor: "var(--status-success-bg)",
    color: "var(--status-success)",
  },
  context: {},
  removed: {
    backgroundColor: "var(--status-error-bg)",
    color: "var(--status-error)",
  },
} as const;

/**
 * The changed words inside a line: the line's own hue a step stronger behind
 * them, and the page's text colour on top, because the line's coloured text
 * on the stronger tint falls to about 3.4:1.
 */
const MARK_STYLE = {
  added: {
    backgroundColor:
      "color-mix(in srgb, var(--status-success) 22%, transparent)",
    color: "var(--foreground)",
  },
  removed: {
    backgroundColor: "color-mix(in srgb, var(--status-error) 22%, transparent)",
    color: "var(--foreground)",
  },
} as const;

const SIGN = { added: "+", context: "", removed: "-" } as const;
const SPOKEN = { added: "Added: ", context: "", removed: "Removed: " } as const;

/**
 * One field's change as a code editor shows it (#839): a box with the
 * field's name for a tab, removed lines then added lines, the changed words
 * marked inside them, and unchanged lines around them. Line numbers only for
 * a value with more than one line; a title has no line 1 worth reading.
 *
 * Colour is not the only signal: each line says "Removed" or "Added" to a
 * screen reader, and changed words are `<del>` and `<ins>`.
 */
function FieldDiff({
  after,
  before,
  label,
}: {
  after: unknown;
  before: unknown;
  label: string;
}) {
  const oldText = editValueText(before);
  const newText = editValueText(after);
  const lines = diffText(oldText, newText);
  const numbered = oldText.includes("\n") || newText.includes("\n");
  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      <div className="border-border bg-muted border-b px-2.5 py-1 text-xs font-medium">
        {label}
      </div>
      {lines.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-1.5 text-xs">
          No visible change.
        </p>
      ) : (
        // Focusable so a keyboard can scroll a long diff, which axe's
        // `scrollable-region-focusable` requires (docs/QUIRKS.md).
        <div
          className="max-h-96 overflow-y-auto py-0.5 font-mono text-xs leading-relaxed"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: see above
          tabIndex={0}
        >
          {lines.map((line, i) =>
            line.kind === "skipped" ? (
              <div
                className="text-muted-foreground bg-muted/50 px-2.5 py-0.5"
                // A diff never reorders, so position is its identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
              >
                {line.count === 1
                  ? "1 unchanged line"
                  : `${line.count} unchanged lines`}
              </div>
            ) : (
              <div
                className="grid grid-cols-[2rem_1rem_minmax(0,1fr)]"
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
                style={LINE_STYLE[line.kind]}
              >
                <span
                  aria-hidden
                  className="text-muted-foreground pr-1.5 text-right select-none"
                >
                  {numbered ? line.number : ""}
                </span>
                <span aria-hidden className="select-none">
                  {SIGN[line.kind]}
                </span>
                <span className="pr-2.5 break-words whitespace-pre-wrap">
                  <span className="sr-only">{SPOKEN[line.kind]}</span>
                  {line.segments.map((segment, j) => {
                    if (!segment.changed || line.kind === "context") {
                      return segment.text;
                    }
                    const Mark = line.kind === "added" ? "ins" : "del";
                    return (
                      <Mark
                        className="rounded-sm no-underline"
                        // biome-ignore lint/suspicious/noArrayIndexKey: see above
                        key={j}
                        style={MARK_STYLE[line.kind]}
                      >
                        {segment.text}
                      </Mark>
                    );
                  })}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

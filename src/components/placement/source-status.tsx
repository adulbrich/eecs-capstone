import {
  ChevronDown,
  ChevronRight,
  CircleX,
  FileText,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { issueCounts } from "#/components/placement/import-issues";
import { plural } from "#/components/placement/roster-section";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { ImportIssue } from "#/lib/placement/csv";
import type { PlacementDataset } from "#/lib/placement/formats";

const ERROR_STYLE = {
  backgroundColor: "var(--status-error-bg)",
  color: "var(--status-error)",
};
const WARNING_STYLE = {
  backgroundColor: "var(--status-warning-bg)",
  color: "var(--status-warning)",
};

/**
 * A loaded source in one line (#739): the file, the format it is read as,
 * what reading it gave, a badge for each kind of problem, and its Remove
 * action. Everything else about the file, `SourceFormat` with Read as, the
 * conversion, the column mapping and the problem lists, sits under Details.
 *
 * Details opens by itself when an error appears, since an error changes
 * what the run sees, and does not close by itself while the strip is
 * mounted, so applying a column mapping that clears the error does not pull
 * its controls away. Closed, the details are hidden rather than unmounted: a
 * column mapping being edited keeps its draft. The caller keys the strip on
 * the file, so a workspace imported over this one starts it over.
 */
export function SourceStatus({
  children,
  dataset,
  filename,
  format,
  issues,
  remove,
  summary,
}: {
  /** The details: `SourceFormat`. */
  children: ReactNode;
  /** For the strip's name. */
  dataset: PlacementDataset;
  filename: string;
  /** The format the file is read as, from `formatName`. */
  format: string;
  /** Every problem the details list, from `shownIssues`. */
  issues: readonly ImportIssue[];
  /** The source's Remove action. */
  remove: ReactNode;
  /** What reading the file gave, as one sentence; left out when unread. */
  summary: ReactNode;
}) {
  const detailsId = useId();
  const { errors, rowsLeftOut, unread, warnings } = issueCounts(issues);
  const hasError = errors > 0;
  const [open, setOpen] = useState(hasError);
  // Derived during render, not in an effect, so the first paint with a new
  // error already shows it (react.dev, "Adjusting some state when a prop
  // changes").
  const [hadError, setHadError] = useState(hasError);
  if (hasError !== hadError) {
    setHadError(hasError);
    if (hasError) {
      setOpen(true);
    }
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    // Not "The bids file": that is a substring of "Problems in the bids
    // file", the problem list's name inside it.
    <section
      aria-label={`Loaded ${dataset} file`}
      className="rounded-md border"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <FileText aria-hidden="true" className="size-4 shrink-0" />
          {/* A long export name breaks rather than running past 375px. */}
          <span className="font-medium wrap-anywhere">{filename}</span>
        </span>
        <Badge variant="outline">{format}</Badge>
        {/* "0 students and 0 bids" beside Not read says the same thing
            twice, and reads as if the file were empty. */}
        {!unread && (
          <span className="text-muted-foreground min-w-0">{summary}</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {unread && (
            <Badge style={ERROR_STYLE} variant="status">
              <CircleX aria-hidden="true" className="size-3" />
              Not read
            </Badge>
          )}
          {!unread && rowsLeftOut > 0 && (
            <Badge style={ERROR_STYLE} variant="status">
              <CircleX aria-hidden="true" className="size-3" />
              {plural(rowsLeftOut, "row", "rows")} left out
            </Badge>
          )}
          {warnings > 0 && (
            <Badge style={WARNING_STYLE} variant="status">
              <TriangleAlert aria-hidden="true" className="size-3" />
              {plural(warnings, "warning", "warnings")}
            </Badge>
          )}
          {/* A disclosure, drawn as the page's others are ("Not in the
              survey", a student's bids): a leading chevron on a ghost
              button. An outline button with a trailing chevron is how this
              app draws a menu or a select. */}
          <Button
            aria-controls={detailsId}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Chevron aria-hidden="true" />
            Details
          </Button>
          {remove}
        </span>
      </div>
      <div className="border-t px-3 pb-3" hidden={!open} id={detailsId}>
        {children}
      </div>
    </section>
  );
}

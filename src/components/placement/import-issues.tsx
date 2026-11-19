import { CircleX, TriangleAlert } from "lucide-react";
import type { ImportIssue } from "#/lib/placement/csv";

/** What a list of import problems adds up to, as its heading says it. */
export interface IssueCounts {
  errors: number;
  /** Rows, or lines, an error left out of the run. */
  rowsLeftOut: number;
  /**
   * A problem with the header or the file's shape stopped every row, so
   * counting rows left out would say one when none was read (#681).
   */
  unread: boolean;
  warnings: number;
}

export function issueCounts(issues: readonly ImportIssue[]): IssueCounts {
  const errors = issues.filter((i) => i.level === "error");
  return {
    errors: errors.length,
    rowsLeftOut: errors.reduce((n, i) => n + (i.rows?.length ?? 1), 0),
    unread: errors.some((i) => i.wholeFile),
    warnings: issues.filter((i) => i.level === "warning").length,
  };
}

/**
 * Every problem an import found, errors first. A row with an error is left
 * out of the run; a warning keeps the row. With `writing`, the problems an
 * export plugin found writing its file, whose rows are those it left out.
 * With `flat`, a plain list under a status strip whose badges already count
 * it (#739): no box of its own and no count, so it draws no second error
 * frame inside the strip's.
 */
export function ImportIssues({
  flat = false,
  issues,
  label,
  unit = "row",
  writing = false,
}: {
  flat?: boolean;
  issues: readonly ImportIssue[];
  label: string;
  /** "line" for pasted text, which has no header row. */
  unit?: "line" | "row";
  /** The file is one placement writes, so it fails to be written, not read. */
  writing?: boolean;
}) {
  if (issues.length === 0) {
    return null;
  }
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const { rowsLeftOut, unread } = issueCounts(issues);
  const where = unit === "line" ? `the pasted ${label}` : `the ${label} file`;
  if (flat) {
    return (
      <section aria-label={`Problems in ${where}`} className="mt-3 text-sm">
        {unread ? (
          <p className="font-medium">
            The {label} file was not {writing ? "written" : "read"}
          </p>
        ) : (
          <p className="text-muted-foreground">In {where}</p>
        )}
        <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
          {[...errors, ...warnings].map((issue) => (
            <li
              className="flex gap-2"
              key={`${issue.level}-${issue.row}-${issue.message}`}
            >
              {issue.level === "error" ? (
                <CircleX
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: "var(--status-error)" }}
                />
              ) : (
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: "var(--status-warning)" }}
                />
              )}
              <span className="text-muted-foreground min-w-16 shrink-0">
                {unit === "line" ? issueLines(issue) : issueRows(issue)}
                <span className="sr-only">
                  {issue.level === "warning" ? " (warning)" : ""}
                  {": "}
                </span>
              </span>
              <span className="min-w-0 wrap-anywhere">{issue.message}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <section
      aria-label={`Problems in ${where}`}
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${errors.length > 0 ? "border-destructive/40" : ""}`}
    >
      {unread ? (
        // Only a file has a header to refuse; a pasted list never does.
        <p className="font-medium">
          The {label} file was not {writing ? "written" : "read"}
        </p>
      ) : (
        <p className="font-medium">
          {errors.length > 0 &&
            `${rowsLeftOut} ${unit}${rowsLeftOut === 1 ? "" : "s"} left out`}
          {errors.length > 0 && warnings.length > 0 && ", "}
          {warnings.length > 0 &&
            `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}{" "}
          <span className="text-muted-foreground font-normal">in {where}</span>
        </p>
      )}
      <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
        {[...errors, ...warnings].map((issue) => (
          <li key={`${issue.level}-${issue.row}-${issue.message}`}>
            <span
              className={
                issue.level === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {unit === "line" ? issueLines(issue) : issueRows(issue)}
              {issue.level === "warning" ? " (warning)" : ""}:
            </span>{" "}
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function issueLines(issue: ImportIssue): string {
  return `Line ${issue.row}`;
}

function issueRows(issue: ImportIssue): string {
  if (issue.row === 1) {
    return "Header";
  }
  if (issue.rows && issue.rows.length > 1) {
    const shown = issue.rows.slice(0, 8).join(", ");
    return `Rows ${shown}${issue.rows.length > 8 ? ", and more" : ""}`;
  }
  return `Row ${issue.row}`;
}

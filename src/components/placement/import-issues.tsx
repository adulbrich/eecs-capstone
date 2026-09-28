import type { ImportIssue } from "#/lib/placement/csv";

/**
 * Every problem an import found, errors first. A row with an error is left
 * out of the run; a warning keeps the row.
 */
export function ImportIssues({
  issues,
  label,
  unit = "row",
}: {
  issues: readonly ImportIssue[];
  label: string;
  /** "line" for pasted text, which has no header row. */
  unit?: "line" | "row";
}) {
  if (issues.length === 0) {
    return null;
  }
  const errors = issues.filter((i) => i.level === "error");
  const rowsLeftOut = errors.reduce((n, i) => n + (i.rows?.length ?? 1), 0);
  const warnings = issues.filter((i) => i.level === "warning");
  const where = unit === "line" ? `the pasted ${label}` : `the ${label} file`;
  // A problem with the header or the file's shape stops every row, so
  // counting rows left out would say one when none was read (#681).
  const unread = errors.some((i) => i.wholeFile);
  return (
    <section
      aria-label={`Problems in ${where}`}
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${errors.length > 0 ? "border-destructive/40" : ""}`}
    >
      {unread ? (
        // Only a file has a header to refuse; a pasted list never does.
        <p className="font-medium">The {label} file was not read</p>
      ) : (
        <p className="font-medium">
          {errors.length > 0 &&
            `${rowsLeftOut} ${unit}${rowsLeftOut === 1 ? "" : "s"} left out`}
          {errors.length > 0 && warnings.length > 0 && ", "}
          {warnings.length > 0 &&
            `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}{" "}
          <span className="font-normal text-muted-foreground">in {where}</span>
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

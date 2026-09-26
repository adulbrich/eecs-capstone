import type { ImportIssue } from "#/lib/placement/csv";

/**
 * Every problem an import found, errors first. A row with an error is left
 * out of the run; a warning keeps the row.
 */
export function ImportIssues({
  issues,
  label,
}: {
  issues: readonly ImportIssue[];
  label: string;
}) {
  if (issues.length === 0) {
    return null;
  }
  const errors = issues.filter((i) => i.level === "error");
  const rowsLeftOut = errors.reduce((n, i) => n + (i.rows?.length ?? 1), 0);
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <section
      aria-label={`Problems in the ${label} file`}
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${errors.length > 0 ? "border-destructive/40" : ""}`}
    >
      <p className="font-medium">
        {errors.length > 0 &&
          `${rowsLeftOut} ${rowsLeftOut === 1 ? "row" : "rows"} left out`}
        {errors.length > 0 && warnings.length > 0 && ", "}
        {warnings.length > 0 &&
          `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}{" "}
        <span className="font-normal text-muted-foreground">
          in the {label} file
        </span>
      </p>
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
              {issueRows(issue)}
              {issue.level === "warning" ? " (warning)" : ""}:
            </span>{" "}
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
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

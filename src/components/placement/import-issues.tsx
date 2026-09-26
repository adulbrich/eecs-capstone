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
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <section
      aria-label={`Problems in the ${label} file`}
      className="mt-4 rounded-md border border-destructive/40 px-3 py-2 text-sm"
    >
      <p className="font-medium">
        {errors.length > 0 &&
          `${errors.length} ${errors.length === 1 ? "row" : "rows"} left out`}
        {errors.length > 0 && warnings.length > 0 && ", "}
        {warnings.length > 0 &&
          `${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"}`}
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
              {issue.row === 1 ? "Header" : `Row ${issue.row}`}
              {issue.level === "warning" ? " (warning)" : ""}:
            </span>{" "}
            {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

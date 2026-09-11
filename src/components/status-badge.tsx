import {
  PROJECT_STATUS_DESCRIPTION,
  PROJECT_STATUS_LABEL,
} from "#/lib/project-workflow";
import type { ProjectStatus } from "#/lib/vocabularies";
import { Badge } from "./ui/badge";

// Keyed by the vocabulary so a new status fails to compile here rather than
// falling through to the neutral grey (#286). There is no `deleted` entry: a
// soft delete is a column, not a status (CONTEXT.md), and nothing ever passed
// the word here.
const STATUS_STYLES: Record<ProjectStatus, { fg: string; bg: string }> = {
  draft: { fg: "var(--status-neutral)", bg: "var(--status-neutral-bg)" },
  submitted: { fg: "var(--status-info)", bg: "var(--status-info-bg)" },
  approved: { fg: "var(--status-success)", bg: "var(--status-success-bg)" },
  changes_requested: {
    fg: "var(--status-warning)",
    bg: "var(--status-warning-bg)",
  },
  published: {
    fg: "var(--brand-primary-dark)",
    bg: "var(--brand-primary-tint)",
  },
  archived: { fg: "var(--status-neutral)", bg: "var(--status-neutral-bg)" },
};

const FALLBACK = {
  fg: "var(--status-neutral)",
  bg: "var(--status-neutral-bg)",
};

export function StatusBadge({ status }: { status: string }) {
  // Callers hand over the wire's `string`, so the fallback stays reachable for
  // a value the enum does not have; the cast only picks the map's row type.
  const { fg, bg } = STATUS_STYLES[status as ProjectStatus] ?? FALLBACK;
  const label =
    PROJECT_STATUS_LABEL[status as ProjectStatus] ?? status.replace(/_/g, " ");
  // The one-line meaning as a native tooltip, the way the staff stepper's
  // pills carry theirs: a hover on the badge answers "what does approved
  // mean for me" without a block of copy on the page (#303).
  const description = PROJECT_STATUS_DESCRIPTION[status as ProjectStatus] as
    | string
    | undefined;
  return (
    <Badge
      style={{ backgroundColor: bg, color: fg }}
      title={description}
      variant="status"
    >
      {label}
    </Badge>
  );
}

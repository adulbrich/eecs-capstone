import { Badge } from "./ui/badge";

const STATUS_STYLES: Record<string, { fg: string; bg: string }> = {
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
  deleted: { fg: "var(--status-error)", bg: "var(--status-error-bg)" },
};

const FALLBACK = {
  fg: "var(--status-neutral)",
  bg: "var(--status-neutral-bg)",
};

export function StatusBadge({ status }: { status: string }) {
  const { fg, bg } = STATUS_STYLES[status] ?? FALLBACK;
  return (
    <Badge style={{ backgroundColor: bg, color: fg }} variant="status">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

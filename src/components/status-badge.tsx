const COLORS: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-800",
  submitted: "bg-blue-200 text-blue-900",
  approved: "bg-purple-200 text-purple-900",
  changes_requested: "bg-amber-200 text-amber-900",
  published: "bg-green-200 text-green-900",
  archived: "bg-neutral-300 text-neutral-700",
};

export function StatusBadge({ status }: { status: string }) {
  const className = COLORS[status] ?? "bg-neutral-200 text-neutral-800";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

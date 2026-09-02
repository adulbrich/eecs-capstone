import { Badge } from "./ui/badge";

/**
 * `type` is the project facet (`docs/QUIRKS.md`, "Categories: domain is
 * closed, type is an open project-only facet"); inventory categories have
 * none, so they pass their `{ id, name }` straight through.
 */
interface Category {
  id: string;
  name: string;
  type?: string | null;
}

/**
 * `compact` keeps the facet off the chip text and puts it in `title`
 * instead. In a table the prefix made every chip a full line and a
 * five-category project a five-line row; the chips arrive ordered by facet,
 * which carries the grouping without the label.
 */
export function CategoryChip({
  category,
  compact = false,
}: {
  category: Category;
  compact?: boolean;
}) {
  const showType = !compact && !!category.type;
  return (
    <Badge
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--chip-line)",
      }}
      title={compact ? (category.type ?? undefined) : undefined}
      variant="status"
    >
      {showType && (
        <span style={{ color: "var(--text-secondary)" }}>{category.type}</span>
      )}
      <span style={{ color: "var(--text-primary)" }}>{category.name}</span>
    </Badge>
  );
}

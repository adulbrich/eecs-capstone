import { Badge } from "./ui/badge";

interface Category {
  id: string;
  name: string;
  type: string | null;
}

export function CategoryChip({ category }: { category: Category }) {
  return (
    <Badge
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--chip-line)",
      }}
      variant="status"
    >
      {category.type && (
        <span style={{ color: "var(--text-secondary)" }}>{category.type}</span>
      )}
      <span style={{ color: "var(--text-primary)" }}>{category.name}</span>
    </Badge>
  );
}

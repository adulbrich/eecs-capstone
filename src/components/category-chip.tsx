type Category = {
  id: string;
  name: string;
  type: string;
};

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
      style={{
        background: "var(--chip-bg)",
        border: "1px solid var(--chip-line)",
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>{category.type}</span>
      <span style={{ color: "var(--text-primary)" }}>{category.name}</span>
    </span>
  );
}

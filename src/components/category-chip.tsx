type Category = {
  id: string;
  name: string;
  type: string;
};

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center gap-1 border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
      <span className="text-neutral-500">{category.type}</span>
      <span>{category.name}</span>
    </span>
  );
}

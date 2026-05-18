import { useEffect, useState } from "react";
import { listCategories } from "#/server/categories";

type Category = {
  id: string;
  name: string;
  type: string;
};

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
};

export function CategoryMultiSelect({ value, onChange }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows } = await listCategories({ data: {} });
        setCategories(rows as Category[]);
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  }

  const grouped = new Map<string, Category[]>();
  for (const c of categories) {
    const arr = grouped.get(c.type) ?? [];
    arr.push(c);
    grouped.set(c.type, arr);
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No categories yet. Create some in /admin/categories.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {[...grouped.entries()].map(([type, items]) => (
        <fieldset
          key={type}
          className="border border-neutral-200 p-2 dark:border-neutral-800"
        >
          <legend className="px-1 text-xs font-medium text-neutral-500">
            {type}
          </legend>
          <div className="flex flex-wrap gap-2">
            {items.map((c) => (
              <label key={c.id} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={value.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

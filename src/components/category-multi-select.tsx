import { useEffect, useState } from "react";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { listCategories } from "#/server/categories";

interface Category {
  id: string;
  name: string;
  type: string;
}

interface Props {
  onChange: (next: string[]) => void;
  value: string[];
}

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
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
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
      <p className="text-neutral-500 text-sm">
        No categories yet. Create some in /admin/categories.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {[...grouped.entries()].map(([type, items]) => (
        <fieldset
          className="border border-neutral-200 p-2 dark:border-neutral-800"
          key={type}
        >
          <legend className="px-1 font-medium text-neutral-500 text-xs">
            {type}
          </legend>
          <div className="flex flex-wrap gap-2">
            {items.map((c) => (
              <Label className="font-normal" key={c.id}>
                <Checkbox
                  checked={value.includes(c.id)}
                  onCheckedChange={() => toggle(c.id)}
                />
                {c.name}
              </Label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

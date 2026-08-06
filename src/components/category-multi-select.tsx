import { useCallback, useEffect, useId, useState } from "react";
import type { z } from "zod";
import { CategoryTypeCombobox } from "#/components/category-type-combobox";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  createCategory,
  listCategories,
  type listSchema,
} from "#/server/categories";

interface Category {
  id: string;
  name: string;
  type: string | null;
}

type Domain = "project" | "inventory";

interface Props {
  domain: Domain;
  onChange: (next: string[]) => void;
  value: string[];
}

export function CategoryMultiSelect({ domain, value, onChange }: Props) {
  const nameInputId = useId();
  const typeInputId = useId();
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const data = { domain } satisfies z.input<typeof listSchema>;
      const { rows } = await listCategories({ data });
      setCategories(rows as Category[]);
      setLoadError(null);
    } catch (err) {
      // Keep the last-good list on failure instead of blanking it: this
      // runs again after a successful create (see handleCreate), and a
      // failed refetch must not wipe out categories that `value` still
      // references and that submit will still write.
      setLoadError(
        err instanceof Error ? err.message : "Could not load categories"
      );
    }
  }, [domain]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function toggle(id: string) {
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    );
  }

  const trimmedName = newName.trim();
  const nameTaken = categories.some(
    (c) => c.name.toLowerCase() === trimmedName.toLowerCase()
  );
  const offerCreate = trimmedName.length > 0 && !nameTaken;
  const trimmedType = newType.trim();
  const canSubmit =
    offerCreate && (domain === "inventory" || trimmedType.length > 0);

  const projectTypes = [
    ...new Set(categories.map((c) => c.type).filter((t): t is string => !!t)),
  ].sort((a, b) => a.localeCompare(b));

  async function handleCreate() {
    setCreateError(null);
    setCreating(true);
    try {
      const { id } =
        domain === "inventory"
          ? await createCategory({
              data: { domain: "inventory", name: trimmedName, type: null },
            })
          : await createCategory({
              data: {
                domain: "project",
                name: trimmedName,
                type: trimmedType,
              },
            });
      onChange([...value, id]);
      setNewName("");
      setNewType("");
      await loadCategories();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Could not create category"
      );
    } finally {
      setCreating(false);
    }
  }

  const grouped = new Map<string, Category[]>();
  if (domain === "project") {
    for (const c of categories) {
      const key = c.type ?? "";
      const arr = grouped.get(key) ?? [];
      arr.push(c);
      grouped.set(key, arr);
    }
  }

  return (
    <div className="space-y-3">
      {loadError && <p className="text-destructive text-sm">{loadError}</p>}
      {!loadError && categories.length === 0 && (
        <p className="text-neutral-500 text-sm">No categories yet.</p>
      )}
      {domain === "project" &&
        [...grouped.entries()].map(([type, items]) => (
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
      {domain === "inventory" && categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Label className="font-normal" key={c.id}>
              <Checkbox
                checked={value.includes(c.id)}
                onCheckedChange={() => toggle(c.id)}
              />
              {c.name}
            </Label>
          ))}
        </div>
      )}

      <div className="space-y-2 border-neutral-200 border-t pt-3 dark:border-neutral-800">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={nameInputId}>New category name</Label>
            <Input
              id={nameInputId}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Category name"
              value={newName}
            />
          </div>
          {domain === "project" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={typeInputId}>Type</Label>
              <CategoryTypeCombobox
                id={typeInputId}
                onChange={setNewType}
                types={projectTypes}
                value={newType}
              />
            </div>
          )}
        </div>
        {offerCreate && (
          <Button
            disabled={creating || !canSubmit}
            onClick={() => void handleCreate()}
            size="sm"
            type="button"
          >
            Create "{trimmedName}"
          </Button>
        )}
        {createError && (
          <p className="text-destructive text-sm">{createError}</p>
        )}
      </div>
    </div>
  );
}

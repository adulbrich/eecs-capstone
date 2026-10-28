import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { z } from "zod";
import { CategoryTypeCombobox } from "#/components/category-type-combobox";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { errorMessage } from "#/lib/error-message";
import {
  createCategory,
  listCategories,
  type listSchema,
} from "#/server/categories";
import { FieldError } from "./ui/field";

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

/**
 * The category list for one domain. A public catalog, so the key names the
 * domain and no viewer. Read again on every mount, as the effect did: staff
 * add categories on the admin pages, which invalidate nothing here.
 */
function categoriesQuery(domain: Domain) {
  return queryOptions({
    queryKey: ["categories", domain],
    queryFn: async () => {
      try {
        const data = { domain } satisfies z.input<typeof listSchema>;
        const { rows } = await listCategories({ data });
        return rows as Category[];
      } catch (error) {
        // A public read never redirects today; caught all the same, since a
        // redirect thrown from a `queryFn` navigates the tab (docs/QUIRKS.md).
        if (isRedirect(error)) {
          return [];
        }
        throw error;
      }
    },
    refetchOnMount: "always",
  });
}

export function CategoryMultiSelect({ domain, value, onChange }: Props) {
  const nameInputId = useId();
  const typeInputId = useId();
  const queryClient = useQueryClient();
  // A failed refetch keeps the last-good list beside the error rather than
  // blanking it: it runs again after a successful create (see handleCreate),
  // and must not wipe out categories that `value` still references and that
  // submit will still write.
  const query = useQuery(categoriesQuery(domain));
  const categories = query.data ?? [];
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const loadError = query.isError
    ? errorMessage(query.error, "Could not load categories")
    : null;

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
      await queryClient.invalidateQueries({
        queryKey: categoriesQuery(domain).queryKey,
      });
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
      <FieldError message={loadError} />
      {!loadError && categories.length === 0 && (
        <p className="text-muted-foreground text-sm">No categories yet.</p>
      )}
      {domain === "project" &&
        [...grouped.entries()].map(([type, items]) => (
          <fieldset className="border border-border p-2" key={type}>
            <legend className="px-1 font-medium text-muted-foreground text-xs">
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

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={nameInputId}>Add a new category</Label>
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
        <FieldError message={createError} />
      </div>
    </div>
  );
}

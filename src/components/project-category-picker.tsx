import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { typeOrder } from "#/lib/categorize";
import { errorMessage } from "#/lib/error-message";
import { categoriesQuery } from "./category-multi-select";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { FieldError } from "./ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface Category {
  id: string;
  name: string;
  type: string | null;
}

/**
 * A plain substring match on the name and type, in place of cmdk's fuzzy
 * score, which matched "ga" to Machine Learning and Existing System by
 * scattered letters. Typing a type's name lists that type.
 */
function containsSearch(value: string, search: string): number {
  return value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0;
}

function byTypeThenName(a: Category, b: Category): number {
  return (
    typeOrder(a.type ?? "", b.type ?? "") ||
    (a.name < b.name ? -1 : Number(a.name > b.name))
  );
}

/**
 * The staff panel's project category control (#31): the categories the
 * project carries as removable chips, and a search to add more, grouped by
 * type. It replaced a checkbox per category, which ran to sixty boxes once the
 * default list landed, and it creates nothing: a new category is made on
 * `/admin/categories`, where staff curate the list, and the section links
 * there.
 */
export function ProjectCategoryPicker({
  onChange,
  value,
}: {
  onChange: (next: string[]) => void;
  value: string[];
}) {
  const query = useQuery(categoriesQuery("project"));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const all = query.data ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  // An id the list no longer returns, a category deleted since the project
  // was saved, still gets a chip, so staff can see it and take it off rather
  // than Save write it back unseen.
  const chosen = query.data
    ? value
        .map(
          (id): Category =>
            byId.get(id) ?? { id, name: "Unknown category", type: null }
        )
        .sort(byTypeThenName)
    : [];
  // Removing a chip unmounts the button that had focus; keyboard users land
  // on Add a category rather than at the top of the page.
  const addButton = useRef<HTMLButtonElement>(null);

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
    addButton.current?.focus();
  }
  const groups = new Map<string, Category[]>();
  for (const c of [...all].sort(byTypeThenName)) {
    if (value.includes(c.id)) {
      continue;
    }
    const key = c.type ?? "";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  function add(id: string) {
    onChange([...value, id]);
    setSearch("");
  }

  return (
    <div className="space-y-2">
      {query.data === undefined && !query.isError && (
        <p className="text-muted-foreground text-sm">Loading categories...</p>
      )}
      {query.data !== undefined && chosen.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No categories on this project yet.
        </p>
      )}
      {chosen.length > 0 && (
        <ul
          aria-label="Categories on this project"
          className="flex flex-wrap gap-1.5"
        >
          {chosen.map((c) => (
            <li key={c.id}>
              <Badge
                className="gap-1 pr-1"
                style={{
                  background: "var(--chip-bg)",
                  border: "1px solid var(--chip-line)",
                }}
                variant="status"
              >
                {c.type && (
                  <span style={{ color: "var(--text-secondary)" }}>
                    {c.type}
                  </span>
                )}
                <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                <Button
                  aria-label={`Remove ${c.name}`}
                  className="-my-1"
                  onClick={() => remove(c.id)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          {/* A combobox takes no name from its content, so the visible text
              is repeated as its label. */}
          <Button
            aria-expanded={open}
            aria-label="Add a category"
            disabled={query.data === undefined}
            ref={addButton}
            role="combobox"
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" />
            Add a category
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command filter={containsSearch}>
            <CommandInput
              onValueChange={setSearch}
              placeholder="Search categories"
              value={search}
            />
            <CommandList>
              <CommandEmpty>No category matches.</CommandEmpty>
              {[...groups].map(([type, items]) => (
                <CommandGroup heading={type} key={type}>
                  {items.map((c) => (
                    <CommandItem
                      key={c.id}
                      onSelect={() => add(c.id)}
                      value={`${c.name} ${type}`}
                    >
                      {c.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldError
        message={
          query.isError
            ? errorMessage(query.error, "Could not load the categories")
            : null
        }
      />
    </div>
  );
}

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { cn } from "#/lib/utils.ts";

interface Props {
  categories: { id: string; name: string }[];
  id?: string;
  onChange: (next: string[]) => void;
  value: string[];
}

function triggerLabel(
  value: string[],
  categories: { id: string; name: string }[]
): string {
  if (value.length === 0) {
    return "All categories";
  }
  if (value.length === 1) {
    return (
      categories.find((c) => c.id === value[0])?.name ?? "1 category selected"
    );
  }
  return `${value.length} categories selected`;
}

/**
 * A Popover + Command multi-select, the same shell `CategoryTypeCombobox`
 * uses, adapted so selecting an item toggles membership in `value` instead
 * of replacing it and closing the popover. Selection is all-match: the
 * caller (a listing query) treats every selected id as required, not "any
 * of these"; hence the trigger stays open across selections so a user can
 * pick several without reopening it each time.
 */
export function CategoryFilterCombobox({
  categories,
  value,
  onChange,
  id,
}: Props) {
  const [open, setOpen] = useState(false);

  function toggle(categoryId: string) {
    onChange(
      value.includes(categoryId)
        ? value.filter((v) => v !== categoryId)
        : [...value, categoryId]
    );
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="w-full justify-between font-normal"
          id={id}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className={cn(value.length === 0 && "text-muted-foreground")}>
            {triggerLabel(value, categories)}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search categories..." />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
            <CommandGroup>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  onSelect={() => toggle(c.id)}
                  value={c.name}
                >
                  <Check
                    className={cn(
                      value.includes(c.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

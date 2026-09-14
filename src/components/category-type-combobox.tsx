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

/**
 * What the two project-category fields mean, under their labels in the New
 * category dialog and on the edit route. The examples live here rather than
 * in a placeholder because a placeholder is not documentation
 * (docs/UI-CONVENTIONS.md), and one string per field keeps the dialog and
 * the edit route saying the same thing (#374).
 */
export const CATEGORY_FIELD_DESCRIPTION = {
  name: "The category itself, such as React under Technology or Robotics under Field.",
  type: "The group this category is filed under in the picker, such as Technology, Field or Industry.",
} as const;

interface Props {
  describedBy?: string;
  id?: string;
  onChange: (type: string) => void;
  types: string[];
  value: string;
}

/**
 * Creatable combobox for category types. Types are derived from existing
 * categories, so the control lets staff pick an existing type or type a
 * brand-new one (preserving the old <datalist> behavior with shadcn styling).
 *
 * The Create row sits below the existing types, not above: a reader who has
 * typed a prefix sees the matches first, so a typo does not mint a new type
 * before the intended one scrolls into view (#374).
 */
export function CategoryTypeCombobox({
  describedBy,
  value,
  onChange,
  types,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const showCreate =
    trimmed.length > 0 &&
    !types.some((t) => t.toLowerCase() === trimmed.toLowerCase());

  function select(type: string) {
    onChange(type);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-describedby={describedBy}
          aria-expanded={open}
          className="w-full justify-between font-normal"
          id={id}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className={cn(!value && "text-muted-foreground")}>
            {value || "Select or create a type"}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search or add a type"
            value={query}
          />
          <CommandList>
            <CommandEmpty>
              No matching type. Press Enter to create one.
            </CommandEmpty>
            <CommandGroup>
              {types.map((t) => (
                <CommandItem key={t} onSelect={() => select(t)} value={t}>
                  <Check
                    className={cn(value === t ? "opacity-100" : "opacity-0")}
                  />
                  {t}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => select(trimmed)}
                  value={`create-${trimmed}`}
                >
                  Create type "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

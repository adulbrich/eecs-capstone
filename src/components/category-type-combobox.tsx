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

type Props = {
  value: string;
  onChange: (type: string) => void;
  types: string[];
  id?: string;
};

/**
 * Creatable combobox for category types. Types are derived from existing
 * categories, so the control lets admins pick an existing type or type a
 * brand-new one (preserving the old <datalist> behavior with shadcn styling).
 */
export function CategoryTypeCombobox({ value, onChange, types, id }: Props) {
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
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
            placeholder="Search or add a type..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No types yet. Type to create one.</CommandEmpty>
            {showCreate && (
              <CommandGroup>
                <CommandItem
                  value={`create-${trimmed}`}
                  onSelect={() => select(trimmed)}
                >
                  Create "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {types.map((t) => (
                <CommandItem key={t} value={t} onSelect={() => select(t)}>
                  <Check
                    className={cn(value === t ? "opacity-100" : "opacity-0")}
                  />
                  {t}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

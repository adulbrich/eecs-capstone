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

export interface FilterProposer {
  email: string;
  id: string;
  name: string;
}

interface Props {
  id: string;
  onChange: (proposerId: string | null) => void;
  proposers: FilterProposer[];
  value: string | null;
}

const ALL_LABEL = "All proposers";

/**
 * A substring match, replacing cmdk's own fuzzy scorer. The default matches a
 * subsequence, so "acme" ranks `grace.kim@oregonstate.edu` alongside
 * `dana.whitfield@acmerobotics.com`, and a list of addresses is exactly where
 * that reads as noise rather than as help.
 */
function matchesSubstring(value: string, search: string): number {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return 1;
  }
  return value.toLowerCase().includes(needle) ? 1 : 0;
}

/**
 * The proposer filter on `/admin/projects`, as a combobox rather than a
 * `Select`: the option list is one row per proposer with a project in the
 * current scope, which is a scroll long before the office runs out of
 * proposers, and a `Select` only jumps by the start of its label, so an
 * address matched nothing and a surname matched nothing either (#452).
 *
 * Filtered in the browser, not on the server. The list is already in the
 * loader payload and is bounded by the projects in scope rather than by the
 * user table, so there is no request to debounce and no superseded result to
 * guard. `AccountSearch` in `proposer-picker.tsx` is the opposite case and
 * stays that way: it searches every account, including people who have
 * proposed nothing.
 *
 * `value` is a user id, the same thing the `Select` put in the URL, so the
 * server contract is untouched. A chosen proposer who falls outside the
 * current status, program or deleted scope is not in `proposers` at all, and
 * the trigger says so rather than going blank.
 */
export function ProposerFilterCombobox({
  id,
  onChange,
  proposers,
  value,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = proposers.find((p) => p.id === value) ?? null;

  let label = ALL_LABEL;
  if (value) {
    label = selected
      ? `${selected.name} (${selected.email})`
      : "Selected proposer (outside current filters)";
  }

  function select(next: string | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          // `font-normal` for the reason UI-CONVENTIONS gives for the
          // category type trigger: a control displaying a chosen value reads
          // as an input, not as a button.
          className="w-full justify-between font-normal"
          id={id}
          role="combobox"
          type="button"
          variant="outline"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command filter={matchesSubstring}>
          <CommandInput placeholder="Search name or email" />
          <CommandList>
            <CommandEmpty>No proposer matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => select(null)} value={ALL_LABEL}>
                <Check className={cn(value ? "opacity-0" : "opacity-100")} />
                {ALL_LABEL}
              </CommandItem>
              {proposers.map((p) => (
                // Both fields in `value`, because that is what cmdk filters
                // on: the visible markup is two spans and it would match
                // neither on its own.
                <CommandItem
                  key={p.id}
                  onSelect={() => select(p.id)}
                  value={`${p.name} ${p.email}`}
                >
                  <Check
                    className={cn(value === p.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="text-muted-foreground text-xs">
                      {p.email}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

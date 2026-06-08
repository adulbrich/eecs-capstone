import { useEffect, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { searchUsers } from "#/server/users";
import { Button } from "./ui/button";

const SEARCH_DEBOUNCE_MS = 250;

interface Match {
  email: string;
  id: string;
  name: string;
}

export function ProposerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({ data: { q: query } })) as Match[];
          setMatches(rows);
        } catch {
          setMatches([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proposerEmail">Proposer email</Label>
      <div className="flex gap-2">
        <Input
          id="proposerEmail"
          name="proposerEmail"
          onChange={(e) => onChange(e.target.value)}
          placeholder="proposer@oregonstate.edu"
          type="email"
          value={value}
        />
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            <Button size="sm" type="button" variant="outline">
              Find account
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                onValueChange={setQuery}
                placeholder="Search accounts..."
                value={query}
              />
              <CommandList>
                <CommandEmpty>No accounts found.</CommandEmpty>
                <CommandGroup>
                  {matches.map((m) => (
                    <CommandItem
                      key={m.id}
                      onSelect={() => {
                        onChange(m.email);
                        setOpen(false);
                      }}
                      value={m.email}
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">
                        {m.email}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-muted-foreground text-xs">
        Links this project to the proposer's account, now or when they first
        sign in with this email. Leave blank for an external proposer.
      </p>
    </div>
  );
}

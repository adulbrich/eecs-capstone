import { useEffect, useState } from "react";
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
import { searchUsers } from "#/server/users";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const SEARCH_DEBOUNCE_MS = 250;

interface Account {
  email: string;
  id: string;
  name: string | null;
}

interface Props {
  email: string;
  label: string;
  name: string;
  onEmailChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onProgramChange: (value: string) => void;
  program: string;
}

/** The account whose address is exactly what is typed, if there is one. */
function exactMatch(rows: Account[], email: string): Account | null {
  const wanted = email.trim().toLowerCase();
  return rows.find((r) => r.email.toLowerCase() === wanted) ?? null;
}

function AccountSearch({ onPick }: { onPick: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Account[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          setMatches((await searchUsers({ data: { q: query } })) as Account[]);
        } catch {
          setMatches([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          Search accounts
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search by name or email..."
            value={query}
          />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              {matches.map((m) => (
                <CommandItem
                  key={m.id}
                  onSelect={() => {
                    onPick(m.email);
                    setOpen(false);
                    setQuery("");
                  }}
                  value={`${m.name ?? ""} ${m.email}`}
                >
                  <span className="font-medium">{m.name ?? m.email}</span>
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
  );
}

/**
 * One field decides everything: an address means the hold is on a person, a
 * blank address means it is on a thing and needs a label. The search popover
 * writes into the same address field rather than holding a separate account
 * object, so picking Ada from the list and typing her address produce
 * identical input, and therefore identical rows.
 */
export function HolderField({
  email,
  label,
  name,
  onEmailChange,
  onLabelChange,
  onNameChange,
  onProgramChange,
  program,
}: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const trimmed = email.trim();

  useEffect(() => {
    if (!trimmed) {
      setAccount(null);
      return;
    }
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({ data: { q: trimmed } })) as
            | Account[]
            | undefined;
          setAccount(exactMatch(rows ?? [], trimmed));
        } catch {
          setAccount(null);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trimmed]);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="holder-email">Email</Label>
        <div className="mt-1 flex gap-2">
          <Input
            id="holder-email"
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="holder@oregonstate.edu"
            type="email"
            value={email}
          />
          <AccountSearch onPick={onEmailChange} />
        </div>
        {account && (
          <p className="mt-1 text-muted-foreground text-xs">
            Matches account: {account.name ?? account.email}
          </p>
        )}
      </div>

      {trimmed && !account && (
        <>
          <div>
            <Label htmlFor="holder-name">Name</Label>
            <Input
              className="mt-1"
              id="holder-name"
              onChange={(e) => onNameChange(e.target.value)}
              value={name}
            />
          </div>
          <div>
            <Label htmlFor="holder-program">Program</Label>
            <Input
              className="mt-1"
              id="holder-program"
              onChange={(e) => onProgramChange(e.target.value)}
              placeholder="e.g. CS 461"
              value={program}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            No account matches this address yet. The hold is still recorded, and
            it links itself if that address signs up later.
          </p>
        </>
      )}

      {!trimmed && (
        <div>
          <Label htmlFor="holder-label">Label</Label>
          <Input
            className="mt-1"
            id="holder-label"
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g. Lab 204"
            value={label}
          />
          <p className="mt-1 text-muted-foreground text-xs">
            Required when the item is not going to a person.
          </p>
        </div>
      )}
    </div>
  );
}

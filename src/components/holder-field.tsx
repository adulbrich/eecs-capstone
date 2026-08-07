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

/**
 * Whether the typed address belongs to an account. `unknown` is not a
 * placeholder for `unmatched`: the lookup is debounced, so every address
 * spends a moment in a state where the answer is genuinely not in yet.
 * Treating that moment as "no account" is what made the dialog flash the
 * Name and Program inputs open and shut whenever it opened on a request
 * whose requester has an account.
 */
export type AccountStatus = "matched" | "unknown" | "unmatched";

interface Props {
  email: string;
  label: string;
  name: string;
  onAccountStatusChange: (status: AccountStatus) => void;
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
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({
            data: { q: query },
          })) as Account[];
          if (cancelled) {
            return;
          }
          setMatches(rows);
        } catch {
          if (cancelled) {
            return;
          }
          setMatches([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
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
  onAccountStatusChange,
  onEmailChange,
  onLabelChange,
  onNameChange,
  onProgramChange,
  program,
}: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<AccountStatus>("unknown");
  const trimmed = email.trim();

  useEffect(() => {
    // Every address starts unknown, including one this effect is about to
    // resolve in 250ms. Nothing downstream may assume "no account" until the
    // lookup has actually said so.
    setAccount(null);
    setStatus("unknown");
    onAccountStatusChange("unknown");
    if (!trimmed) {
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const settle = (match: Account | null) => {
          setAccount(match);
          const next: AccountStatus = match ? "matched" : "unmatched";
          setStatus(next);
          onAccountStatusChange(next);
        };
        try {
          const rows = (await searchUsers({ data: { q: trimmed } })) as
            | Account[]
            | undefined;
          if (cancelled) {
            return;
          }
          settle(exactMatch(rows ?? [], trimmed));
        } catch {
          if (cancelled) {
            return;
          }
          // A failed lookup is not evidence of no account, but staff still
          // need a way to record a walk-in, so treat it as unmatched and let
          // the server have the final say when it resolves the address.
          settle(null);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed, onAccountStatusChange]);

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

      {/* Gated on the resolved answer, not on the absence of one. While the
          lookup is still out these stay closed, so an address that turns out
          to have an account never opens them at all. */}
      {trimmed && status === "unmatched" && (
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

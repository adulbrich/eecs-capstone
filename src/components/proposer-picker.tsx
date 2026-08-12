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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const SEARCH_DEBOUNCE_MS = 250;

interface Match {
  email: string;
  id: string;
  name: string;
}

function AccountSearch({ onPick }: { onPick: (email: string) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      return;
    }
    // The timer alone is not enough: clearing it stops a query that has not
    // fired, but a request already in flight still resolves and would apply a
    // superseded result. Same guard holder-field.tsx uses on both its lookups.
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const rows = (await searchUsers({ data: { q: query } })) as Match[];
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
              onSelect={() => onPick(m.email)}
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
  );
}

export function ProposerPicker({
  accountLinked,
  accountName,
  value,
  onChange,
}: {
  accountLinked: boolean;
  accountName: string | null;
  value: string;
  onChange: (email: string) => void;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  // Captured once at mount: the address that was actually saved. accountLinked
  // and accountName describe that saved state, not whatever staff have typed
  // or picked since. Comparing the live value against this snapshot is how we
  // know the on-screen state has diverged from what those props still claim.
  const [savedEmail] = useState(value);
  const pendingChange = value !== savedEmail;
  const locked = accountLinked && !pendingChange;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proposerEmail">Proposer email</Label>
      <div className="flex gap-2">
        <Input
          className={locked ? "bg-muted text-muted-foreground" : undefined}
          id="proposerEmail"
          name="proposerEmail"
          onChange={(e) => onChange(e.target.value)}
          placeholder="proposer@oregonstate.edu"
          // Read-only rather than disabled: a disabled input is skipped by
          // keyboard navigation and announced poorly, and staff still need to
          // read and copy the address.
          readOnly={locked}
          type="email"
          value={value}
        />
        {locked ? (
          <Button
            className="h-9"
            onClick={() => setReassignOpen(true)}
            type="button"
            variant="outline"
          >
            Re-assign
          </Button>
        ) : (
          <Popover onOpenChange={setFindOpen} open={findOpen}>
            <PopoverTrigger asChild>
              <Button className="h-9" type="button" variant="outline">
                Find account
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <AccountSearch
                onPick={(email) => {
                  onChange(email);
                  setFindOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {(() => {
          if (locked) {
            return `Linked to ${accountName ?? "an account"}. Re-assign to move this project to a different person.`;
          }
          if (pendingChange) {
            return value
              ? `This project will be re-assigned to ${value} when saved.`
              : "The link will be removed when saved. Enter an external proposer's address, or leave it blank.";
          }
          return "Links to the proposer's account once they verify this email address. Leave blank for an external proposer.";
        })()}
      </p>

      <Dialog onOpenChange={setReassignOpen} open={reassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-assign this project</DialogTitle>
            <DialogDescription>
              {`This project belongs to ${accountName ?? value}. Choosing someone else moves it to them: it leaves the current proposer's list and they stop receiving updates about it.`}
            </DialogDescription>
          </DialogHeader>
          <AccountSearch
            onPick={(email) => {
              onChange(email);
              setReassignOpen(false);
            }}
          />
          <DialogFooter className="sm:justify-between">
            <Button
              onClick={() => {
                onChange("");
                setReassignOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              Remove the link and set an external proposer
            </Button>
            <Button
              onClick={() => setReassignOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

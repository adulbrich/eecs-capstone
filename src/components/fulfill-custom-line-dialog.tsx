import { useEffect, useState } from "react";
import { listAdminInventory } from "#/server/inventory";
import { fulfillCustomLine } from "#/server/inventory-custom";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const SEARCH_DEBOUNCE_MS = 250;
const MATCH_LIMIT = 8;

interface Match {
  id: string;
  name: string;
}

/**
 * Fulfil links items that already exist; it never creates one. The picker
 * searches available items by name through the staff listing, so the one
 * item form stays the one place an item is made. Reserving to the requester
 * is ticked by default: the thing arrived for someone, and that someone is
 * on the line.
 */
export function FulfillCustomLineDialog({
  line,
  onDone,
}: {
  line: { id: string; name: string; quantity: number };
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [chosen, setChosen] = useState<Match[]>([]);
  const [reserve, setReserve] = useState(true);
  const [pickupBy, setPickupBy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!(open && query.trim())) {
      setMatches([]);
      return;
    }
    // The timer alone is not enough: a request already in flight would apply
    // a superseded result. Same guard proposer-picker.tsx uses.
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const { rows } = await listAdminInventory({
            data: {
              categories: [],
              q: query,
              retiredOnly: false,
              status: "available",
            },
          });
          if (!cancelled) {
            setMatches(
              rows
                .slice(0, MATCH_LIMIT)
                .map((r) => ({ id: r.id, name: r.name }))
            );
          }
        } catch {
          if (!cancelled) {
            setMatches([]);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  function reset() {
    setQuery("");
    setMatches([]);
    setChosen([]);
    setReserve(true);
    setPickupBy("");
    setNote("");
    setError(null);
  }

  // One close path for Escape, the overlay and the Cancel button alike. A
  // Cancel that only set `open` skipped the reset, and the links built for
  // one line were waiting in the dialog when it was opened on the next.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
    }
  }

  async function onConfirm() {
    if (chosen.length === 0) {
      setError("Link at least one item");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fulfillCustomLine({
        data: {
          customLineId: line.id,
          itemIds: chosen.map((item) => item.id),
          outcomeNote: note.trim() ? note : null,
          pickupBy: reserve && pickupBy ? new Date(pickupBy) : null,
          reserve,
        },
      });
      reset();
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error)?.message || "Fulfil failed");
    } finally {
      setBusy(false);
    }
  }

  const available = matches.filter(
    (match) => !chosen.some((item) => item.id === match.id)
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button">
          Fulfil
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fulfil: {line.name}</DialogTitle>
          <DialogDescription>
            Link the item{line.quantity === 1 ? "" : "s"} that arrived, or one
            we already had. Asked for: {line.quantity}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`fulfil-search-${line.id}`}>
            Find an available item
          </Label>
          <Input
            autoComplete="off"
            id={`fulfil-search-${line.id}`}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Item name or serial"
            type="search"
            value={query}
          />
          {available.length > 0 && (
            <ul
              aria-label="Matches"
              className="divide-y divide-border rounded-md border"
            >
              {available.map((match) => (
                <li
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
                  key={match.id}
                >
                  <span className="truncate">{match.name}</span>
                  <Button
                    onClick={() => setChosen([...chosen, match])}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="font-medium text-sm">Linked ({chosen.length})</p>
          {chosen.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing linked yet.</p>
          ) : (
            <ul aria-label="Linked items" className="mt-1 space-y-1">
              {chosen.map((item) => (
                <li
                  className="flex items-center justify-between gap-2 text-sm"
                  key={item.id}
                >
                  <span className="truncate">{item.name}</span>
                  <Button
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      setChosen(chosen.filter((c) => c.id !== item.id))
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={reserve}
            id={`fulfil-reserve-${line.id}`}
            onCheckedChange={(checked) => setReserve(checked === true)}
          />
          <Label htmlFor={`fulfil-reserve-${line.id}`}>
            Reserve to the requester with a pickup deadline
          </Label>
        </div>
        {reserve && (
          <div className="space-y-1.5">
            <Label htmlFor={`fulfil-pickup-${line.id}`}>
              Pickup by (optional)
            </Label>
            <Input
              id={`fulfil-pickup-${line.id}`}
              onChange={(e) => setPickupBy(e.target.value)}
              type="date"
              value={pickupBy}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`fulfil-note-${line.id}`}>
            Note for the requester (optional)
          </Label>
          <Textarea
            id={`fulfil-note-${line.id}`}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            value={note}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => void onConfirm()}
            type="button"
          >
            {busy ? "Saving..." : "Confirm fulfil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

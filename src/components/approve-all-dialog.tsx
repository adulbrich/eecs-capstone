import { useState } from "react";
import { approveRequestLines } from "#/server/inventory";
import { Button } from "./ui/button";
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

export interface ApproveAllLine {
  id: string;
  itemName: string;
  status: string;
}

/**
 * One decision over a whole request: every line still pending takes the one
 * pickup date, or none does. Sits on the group header of the request queue.
 *
 * The dialog lists what it is about to approve, and sends exactly those ids:
 * a line decided between the render and the click fails the batch on the
 * server, which names the item, rather than being silently skipped. Lines
 * already decided are never sent, so they are left alone by construction.
 * Renders nothing once no line is pending, matching `AdminRequestActions`.
 */
export function ApproveAllDialog({
  lines,
  onDone,
}: {
  lines: ApproveAllLine[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickupBy, setPickupBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = lines.filter((line) => line.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  const count = pending.length;

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await approveRequestLines({
        data: {
          requestItemIds: pending.map((line) => line.id),
          pickupBy: pickupBy ? new Date(pickupBy) : null,
        },
      });
      setPickupBy("");
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error)?.message || "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  // One close path for Escape, the overlay and the Cancel button alike. A
  // Cancel that only set `open` skipped this, and a refusal from one attempt
  // was still on screen when the dialog was next opened.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button">
          Approve all
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Approve {count} {count === 1 ? "line" : "lines"}
          </DialogTitle>
          <DialogDescription>
            Every pending line in this request is reserved to the requester with
            the same pickup deadline.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {pending.map((line) => (
            <li key={line.id}>{line.itemName}</li>
          ))}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="approve-all-pickup">Pickup by (optional)</Label>
          <Input
            id="approve-all-pickup"
            onChange={(e) => setPickupBy(e.target.value)}
            type="date"
            value={pickupBy}
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
            {busy ? "Saving..." : "Confirm approve all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

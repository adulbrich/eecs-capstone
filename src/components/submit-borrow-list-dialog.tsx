import { useState } from "react";
import { useAction } from "#/lib/use-action";
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
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * Submit, on the borrow list's group header. The one note for the whole
 * request lives in the dialog rather than on the strip, which keeps the
 * header a header. The server call stays in the route, which owns the refetch
 * and the confirmation; this collects the note, runs the call, and reports a
 * refusal.
 *
 * The dialog owns the flight, the way `ConfirmDialog` does. It used to close
 * and clear the note whatever `onSubmit` did, so a submit the server refused
 * looked exactly like one it took (#410).
 */
export function SubmitBorrowListDialog({
  count,
  disabled = false,
  onSubmit,
}: {
  count: number;
  /** Another action on the page is in flight. Not this one's own busy state. */
  disabled?: boolean;
  onSubmit: (note: string | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, run, setError } = useAction({
    fallback: "Could not submit the request",
  });

  // Every close goes through here, Cancel included. Radix calls
  // `onOpenChange` for Escape and the trigger, but a Cancel that sets the
  // state itself would skip it and leave the last refusal waiting in the
  // dialog when it reopens.
  function changeOpen(next: boolean) {
    if (!next) {
      // A refusal belongs to one attempt, the way ConfirmDialog treats its
      // own: reopening starts clean.
      setError(null);
    }
    setOpen(next);
  }
  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={disabled} size="sm" type="button">
          Submit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Submit {count} {count === 1 ? "item" : "items"} as one request
          </DialogTitle>
          <DialogDescription>
            Staff approve each line and tell you when to pick it up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="borrow-list-note">Note for staff (optional)</Label>
          <Textarea
            id="borrow-list-note"
            onChange={(e) => setNote(e.target.value)}
            placeholder="When you need it, or which project it is for"
            rows={2}
            value={note}
          />
          <FieldError message={error} />
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => changeOpen(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onSubmit(note.trim() ? note : null);
                setNote("");
                changeOpen(false);
              })
            }
            type="button"
          >
            {busy ? "Submitting..." : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

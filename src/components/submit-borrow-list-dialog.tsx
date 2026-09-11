import { useState } from "react";
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
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * Submit, on the borrow list's group header. The one note for the whole
 * request lives in the dialog rather than on the strip, which keeps the
 * header a header. The server call stays in the route, which also owns the
 * refetch and the error toast; this only collects the note and hands it over.
 */
export function SubmitBorrowListDialog({
  busy,
  count,
  onSubmit,
}: {
  busy: boolean;
  count: number;
  onSubmit: (note: string | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={busy} size="sm" type="button">
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
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              await onSubmit(note.trim() ? note : null);
              setNote("");
              setOpen(false);
            }}
            type="button"
          >
            {busy ? "Submitting..." : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

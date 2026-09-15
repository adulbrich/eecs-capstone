import { useState } from "react";
import { SendEmailCheckbox } from "./send-email-checkbox";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * The confirm a save opens when it would email someone (#379): it names the
 * address, carries the skip, and holds the save until staff confirm. Shaped
 * like the transition dialog in `staff-project-panel.tsx`, which keeps its
 * own because it also takes a comment. The Mentor and Proposer sections open
 * it only when the pending change would send mail; a save that mails nobody
 * goes straight through.
 *
 * `error` and `busy` are the section's: the save runs there, and a failure
 * shows in the open dialog rather than behind it.
 */
export function SendEmailDialog({
  address,
  busy,
  confirmLabel,
  description,
  error,
  hint,
  onConfirm,
  onOpenChange,
  open,
  title,
}: {
  address: string;
  busy: boolean;
  confirmLabel: string;
  description: string;
  error: string | null;
  hint: string;
  onConfirm: (sendEmail: boolean) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const [sendEmail, setSendEmail] = useState(true);
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          // Checked again next time: the skip is a decision about one save.
          setSendEmail(true);
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <SendEmailCheckbox
          address={address}
          checked={sendEmail}
          disabled={busy}
          hint={hint}
          onCheckedChange={setSendEmail}
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => onConfirm(sendEmail)}
            type="button"
          >
            {busy ? "Saving..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

interface SendEmailDialogProps {
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
}

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
export function SendEmailDialog(props: SendEmailDialogProps) {
  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent>
        <Body {...props} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Holds the checkbox. Radix unmounts the content while the dialog is closed,
 * so the box is checked again on every open however the last one ended:
 * Cancel, Escape, or a save that closed it. The skip is a decision about
 * one save.
 */
function Body({
  address,
  busy,
  confirmLabel,
  description,
  error,
  hint,
  onConfirm,
  onOpenChange,
  title,
}: SendEmailDialogProps) {
  const [sendEmail, setSendEmail] = useState(true);
  return (
    <>
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
          variant="outline"
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
    </>
  );
}

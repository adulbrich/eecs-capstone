import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { approveRequestLines } from "#/server/inventory";
import {
  EMPTY_PICKUP,
  PickupFields,
  type PickupFormValue,
  pickupPayload,
} from "./pickup-fields";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
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

export interface ApproveAllLine {
  id: string;
  itemName: string;
  status: string;
}

/**
 * One decision over a whole request: every line still pending takes the one
 * set of pickup terms, or none does. Sits on the group header of the request
 * queue.
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
  requesterEmail,
}: {
  lines: ApproveAllLine[];
  onDone: () => Promise<void>;
  /** One requester per request, so one address for the whole batch (#387). */
  requesterEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState<PickupFormValue>(EMPTY_PICKUP);
  const [sendEmail, setSendEmail] = useState(true);
  // A second activation in the same tick would approve the whole batch
  // twice; `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run, setError } = useAction({
    fallback: "Approve failed",
  });
  const pending = lines.filter((line) => line.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  const count = pending.length;

  function onConfirm() {
    return run(async () => {
      await approveRequestLines({
        data: {
          requestItemIds: pending.map((line) => line.id),
          ...pickupPayload(pickup),
          sendEmail,
        },
      });
      setPickup(EMPTY_PICKUP);
      await onDone();
      setOpen(false);
    });
  }

  // One close path for Escape, the overlay and the Cancel button alike. A
  // Cancel that only set `open` skipped this, and a refusal from one attempt
  // was still on screen when the dialog was next opened.
  // Refuses to close while the write is in flight, and this is the only place
  // that check belongs: every dismissal route Radix offers, Escape, a click
  // outside, the close X and the Cancel button, funnels through here, so a
  // guard on the individual routes misses whichever one nobody thought of.
  // The X is exactly that: it goes straight to `onOpenChange` and bypassed
  // `onEscapeKeyDown` and `onInteractOutside` entirely.
  //
  // Why refusing matters: the trigger is `disabled` while busy, a disabled
  // element cannot hold focus, and closing hands focus back to the trigger. A
  // reader who dismissed mid-write landed on `<body>` with no keyboard route
  // back to the row (#426). Cancel was already refused, so this takes away
  // nothing the surface offered.
  function onOpenChange(next: boolean) {
    if (!next && busy) {
      return;
    }
    setOpen(next);
    if (!next) {
      setError(null);
      setSendEmail(true);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button disabled={busy} size="sm" type="button">
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
            the same pickup window, place and note.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {pending.map((line) => (
            <li key={line.id}>{line.itemName}</li>
          ))}
        </ul>
        {/* No place is copied in and no location is listed: the items can
            sit in different places, none of which is where the requester
            goes, and a storage location is staff only (#799). */}
        <PickupFields
          disabled={busy}
          idPrefix="approve-all-pickup"
          onChange={setPickup}
          placeHint="Left blank, the requester is told no place. They see what is here."
          value={pickup}
        />
        <SendEmailCheckbox
          address={requesterEmail}
          checked={sendEmail}
          disabled={busy}
          hint={EMAIL_SKIP_HINT.withBell}
          onCheckedChange={setSendEmail}
        />
        <FieldError message={error} />
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

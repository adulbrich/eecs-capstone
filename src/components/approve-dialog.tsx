import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { approveRequestItem, approveRequestLines } from "#/server/inventory";
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

export interface ApproveLine {
  id: string;
  itemName: string;
  status: string;
}

/**
 * What one dialog approves: a line from its row, or every pending line of a
 * request from its group header. Only a line copies the item's location into
 * "Where to pick up"; a request's items can sit in different places, none of
 * which is where the requester goes, and a storage location is staff only
 * (ADR-0065).
 */
export type ApproveScope =
  | { itemLocation: string | null; kind: "line"; line: ApproveLine }
  | { kind: "request"; lines: ApproveLine[] };

/**
 * The approve form, one for both scopes, so a line and a request take the
 * same pickup terms in the same layout (#799). Renders nothing once no line
 * in scope is pending, matching the decided rows that offer no action.
 *
 * A request's dialog lists what it is about to approve and sends exactly
 * those ids: a line decided between the render and the click fails the batch
 * on the server, which names the item, rather than being silently skipped.
 * Lines already decided are never sent, so they are left alone by
 * construction.
 */
export function ApproveDialog({
  disabled = false,
  onDone,
  requester,
  scope,
}: {
  /** Holds the trigger off while a sibling decision on the row is writing. */
  disabled?: boolean;
  onDone: () => Promise<void>;
  /** One requester per request, so one address for every line (#387). */
  requester: { email: string | null; name: string | null };
  scope: ApproveScope;
}) {
  const [open, setOpen] = useState(false);
  const [pickup, setPickup] = useState<PickupFormValue>(EMPTY_PICKUP);
  // Whether staff typed in the form since it was last sent. Until they do, a
  // line's dialog copies the item's location in afresh on every open.
  const [edited, setEdited] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  // A second activation in the same tick would approve twice; `use-action.ts`
  // says why the hook's ref is what stops it (#443).
  const { busy, error, run, setError } = useAction({
    fallback: "Approve failed",
  });
  const inScope = scope.kind === "line" ? [scope.line] : scope.lines;
  const pending = inScope.filter((line) => line.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  const count = pending.length;
  const who = requester.name ?? requester.email ?? "the requester";

  function onConfirm() {
    return run(async () => {
      const terms = pickupPayload(pickup);
      if (scope.kind === "line") {
        await approveRequestItem({
          data: { requestItemId: scope.line.id, ...terms, sendEmail },
        });
      } else {
        await approveRequestLines({
          data: {
            requestItemIds: pending.map((line) => line.id),
            ...terms,
            sendEmail,
          },
        });
      }
      setPickup(EMPTY_PICKUP);
      setEdited(false);
      await onDone();
      setOpen(false);
    });
  }

  function onPickupChange(next: PickupFormValue) {
    setEdited(true);
    setPickup(next);
  }

  // One close path for Escape, the overlay, the close X and Cancel alike, and
  // the only place the mid-write refusal belongs: every dismissal route Radix
  // offers funnels through here, so a guard on the individual routes misses
  // whichever one nobody thought of. The X goes straight to `onOpenChange`
  // and bypasses `onEscapeKeyDown` and `onInteractOutside` entirely.
  //
  // Why refusing matters: the trigger is `disabled` while busy, a disabled
  // element cannot hold focus, and closing hands focus back to the trigger. A
  // reader who dismissed mid-write landed on `<body>` with no keyboard route
  // back to the row (#426).
  function onOpenChange(next: boolean) {
    if (!next && busy) {
      return;
    }
    // An untouched form takes the item's location as it is now, so a location
    // edited while the row sat on screen is the one copied; one staff typed
    // into and then cancelled keeps what they typed, so a reopen discards
    // nothing.
    if (next && scope.kind === "line" && !edited) {
      setPickup({ ...EMPTY_PICKUP, place: scope.itemLocation ?? "" });
    }
    setOpen(next);
    if (!next) {
      setError(null);
      setSendEmail(true);
    }
  }

  const single = scope.kind === "line";
  let placeHint =
    "Left blank, the requester is told no place. They see what is here.";
  if (single) {
    placeHint = scope.itemLocation
      ? "Copied from the item's location. The requester sees what is here."
      : "The requester sees what is here.";
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button disabled={busy || disabled} size="sm" type="button">
          {single ? "Approve" : "Approve all"}
        </Button>
      </DialogTrigger>
      {/* Seven controls outgrow a phone in landscape or with the keyboard
          up, and the dialog is fixed to the viewport's centre with the page
          behind it locked, so it scrolls inside itself instead of clipping
          Confirm out of reach. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          {/* A request has no name of its own, so the requester names it. */}
          <DialogTitle>
            {single
              ? `Approve ${pending[0].itemName} for ${who}`
              : `Approve ${count} ${count === 1 ? "line" : "lines"} for ${who}`}
          </DialogTitle>
          <DialogDescription>
            {single
              ? "Reserved to the requester with the pickup window, place and note below."
              : "Every pending line below is reserved to the requester with the same pickup window, place and note."}
          </DialogDescription>
        </DialogHeader>
        {!single && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {pending.map((line) => (
              <li key={line.id}>{line.itemName}</li>
            ))}
          </ul>
        )}
        <PickupFields
          disabled={busy}
          idPrefix={single ? `approve-${scope.line.id}` : "approve-all-pickup"}
          onChange={onPickupChange}
          placeHint={placeHint}
          value={pickup}
        />
        <SendEmailCheckbox
          address={requester.email}
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
            {busy ? "Saving..." : `Confirm approve${single ? "" : " all"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

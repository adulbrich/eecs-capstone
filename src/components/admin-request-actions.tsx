import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { rejectRequestItem } from "#/server/inventory";
import { ApproveDialog } from "./approve-dialog";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";

interface Props {
  /**
   * The item's storage location, copied into "Where to pick up" when the
   * approve dialog opens. One item, so one location; staff see the copy and
   * usually replace it with the office. A whole request's dialog never does.
   */
  itemLocation: string | null;
  /** Names the line in the approve dialog's title. */
  itemName: string;
  lineId: string;
  /**
   * Called after a decision lands, so the caller can refetch. The router is
   * deliberately not reached for in here: a cell that needs router context
   * cannot be rendered in a test.
   */
  onDone: () => Promise<void>;
  /** Who is emailed by either decision; named on the skip (#387). */
  requesterEmail: string;
  /** Names the request in the approve dialog's title; the address stands in. */
  requesterName: string | null;
  status: string;
}

/**
 * Approve / reject for one request line, sized for a table cell. Approve
 * opens the same dialog as a whole request's Approve all, because its pickup
 * terms are a form rather than a confirmation (#799); reject stays a popover
 * with its one reason. Both decisions email the requester and write their
 * bell row, and each surface carries the skip.
 */
export function AdminRequestActions({
  itemLocation,
  itemName,
  lineId,
  onDone,
  requesterEmail,
  requesterName,
  status,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  // A second activation in the same tick would decide the line twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run, setError } = useAction({
    fallback: "Reject failed",
  });

  // Approving or rejecting is a one-way door, so a decided line offers
  // nothing rather than a disabled control.
  if (status !== "pending") {
    return <span className="text-muted-foreground">-</span>;
  }

  // The skip is a decision about one click, so it is checked again next time.
  /** Closes and resets. Called by Cancel, by `dismiss` and by the success path. */
  function close() {
    setOpen(false);
    setError(null);
    setSendEmail(true);
  }

  /**
   * The dismissal path, and the only one that refuses. Escape and a click
   * outside both arrive through `onOpenChange`, so guarding here covers every
   * route Radix offers rather than the two anybody thought to name.
   *
   * Why refuse at all: the trigger is `disabled` while busy, a disabled
   * element cannot hold focus, and closing hands focus back to the trigger, so
   * dismissing mid-write dropped the reader on `<body>` with no keyboard route
   * back to the row (#426). Cancel does not come through here: it calls
   * `close` directly and is `disabled={busy}`, so it is unreachable mid-write
   * anyway.
   *
   * Separate from `close` on purpose. The success path closes while `busy` is
   * still true and must not be refused; relying on its click-time closure
   * still holding `busy === false` would work today and break the first time
   * anyone reorders those two lines.
   */
  function dismiss() {
    if (busy) {
      return;
    }
    close();
  }

  function onReject() {
    if (!reason.trim()) {
      setError("Reason required");
      return;
    }
    return run(async () => {
      await rejectRequestItem({
        data: { requestItemId: lineId, reviewComment: reason, sendEmail },
      });
      setReason("");
      await onDone();
      close();
    });
  }

  return (
    <div className="flex gap-2">
      {/* Held off while a rejection writes, so the row never offers a second
          decision over itself (#426). The reverse needs no prop: the dialog
          is modal. */}
      <ApproveDialog
        disabled={busy}
        onDone={onDone}
        requester={{ email: requesterEmail, name: requesterName }}
        scope={{
          kind: "line",
          itemLocation,
          line: { id: lineId, itemName, status },
        }}
      />

      <Popover
        onOpenChange={(next) => (next ? setOpen(true) : dismiss())}
        open={open}
      >
        <PopoverTrigger asChild>
          <Button disabled={busy} size="sm" type="button" variant="outline">
            Reject
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2">
          <Label htmlFor={`reason-${lineId}`}>Reason (sent to requester)</Label>
          <Textarea
            id={`reason-${lineId}`}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            value={reason}
          />
          <SendEmailCheckbox
            address={requesterEmail}
            checked={sendEmail}
            disabled={busy}
            hint={EMAIL_SKIP_HINT.withBell}
            onCheckedChange={setSendEmail}
          />
          <FieldError message={error} />
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void onReject()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {busy ? "Saving..." : "Confirm reject"}
            </Button>
            <Button
              disabled={busy}
              onClick={close}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

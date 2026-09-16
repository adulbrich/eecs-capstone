import { useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { approveRequestItem, rejectRequestItem } from "#/server/inventory";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";

interface Props {
  lineId: string;
  /**
   * Called after a decision lands, so the caller can refetch. The router is
   * deliberately not reached for in here: a cell that needs router context
   * cannot be rendered in a test.
   */
  onDone: () => Promise<void>;
  /** Who is emailed by either decision; named on the skip (#387). */
  requesterEmail: string;
  status: string;
}

/**
 * Approve / reject for one request line, sized for a table cell. The queue
 * used to render these forms inline in a card, which a cell has no room for,
 * so each decision opens in a popover instead. Both decisions email the
 * requester and write their bell row; the popover carries the skip.
 */
export function AdminRequestActions({
  lineId,
  onDone,
  requesterEmail,
  status,
}: Props) {
  const [open, setOpen] = useState<null | "approve" | "reject">(null);
  const [pickupBy, setPickupBy] = useState("");
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approving or rejecting is a one-way door, so a decided line offers
  // nothing rather than a disabled control.
  if (status !== "pending") {
    return <span className="text-muted-foreground">-</span>;
  }

  // One cleanup for both popovers, run by every control that closes one.
  // The skip is a decision about one click, so it is checked again next time.
  /** Closes and resets. Called by Cancel, by `dismiss` and by the success path. */
  function close() {
    setOpen(null);
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

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveRequestItem({
        data: {
          requestItemId: lineId,
          pickupBy: pickupBy ? new Date(pickupBy) : null,
          sendEmail,
        },
      });
      setPickupBy("");
      await onDone();
      close();
    } catch (e) {
      setError(errorMessage(e, "Approve failed"));
    } finally {
      setBusy(false);
    }
  }

  async function onReject() {
    if (!reason.trim()) {
      setError("Reason required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rejectRequestItem({
        data: { requestItemId: lineId, reviewComment: reason, sendEmail },
      });
      setReason("");
      await onDone();
      close();
    } catch (e) {
      setError(errorMessage(e, "Reject failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Popover
        onOpenChange={(next) => (next ? setOpen("approve") : dismiss())}
        open={open === "approve"}
      >
        <PopoverTrigger asChild>
          <Button disabled={busy} size="sm" type="button">
            Approve
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2">
          <Label htmlFor={`pickup-${lineId}`}>Pickup by (optional)</Label>
          <Input
            id={`pickup-${lineId}`}
            onChange={(e) => setPickupBy(e.target.value)}
            type="date"
            value={pickupBy}
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
              onClick={() => void onApprove()}
              size="sm"
              type="button"
            >
              {busy ? "Saving..." : "Confirm approve"}
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

      <Popover
        onOpenChange={(next) => (next ? setOpen("reject") : dismiss())}
        open={open === "reject"}
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

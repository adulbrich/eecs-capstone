import { useState } from "react";
import { approveRequestItem, rejectRequestItem } from "#/server/inventory";
import { Button } from "./ui/button";
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
  onDone: () => void;
  status: string;
}

/**
 * Approve / reject for one request line, sized for a table cell. The queue
 * used to render these forms inline in a card, which a cell has no room for,
 * so each decision opens in a popover instead.
 */
export function AdminRequestActions({ lineId, onDone, status }: Props) {
  const [open, setOpen] = useState<null | "approve" | "reject">(null);
  const [pickupBy, setPickupBy] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approving or rejecting is a one-way door, so a decided line offers
  // nothing rather than a disabled control.
  if (status !== "pending") {
    return <span className="text-muted-foreground">-</span>;
  }

  function close() {
    setOpen(null);
    setError(null);
  }

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveRequestItem({
        data: {
          requestItemId: lineId,
          pickupBy: pickupBy ? new Date(pickupBy) : null,
        },
      });
      setPickupBy("");
      close();
      onDone();
    } catch (e) {
      setError((e as Error)?.message || "Approve failed");
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
        data: { requestItemId: lineId, reviewComment: reason },
      });
      setReason("");
      close();
      onDone();
    } catch (e) {
      setError((e as Error)?.message || "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Popover
        onOpenChange={(next) => setOpen(next ? "approve" : null)}
        open={open === "approve"}
      >
        <PopoverTrigger asChild>
          <Button size="sm">Approve</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2">
          <Label htmlFor={`pickup-${lineId}`}>Pickup by (optional)</Label>
          <Input
            id={`pickup-${lineId}`}
            onChange={(e) => setPickupBy(e.target.value)}
            type="date"
            value={pickupBy}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void onApprove()} size="sm">
              {busy ? "Saving..." : "Confirm approve"}
            </Button>
            <Button disabled={busy} onClick={close} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover
        onOpenChange={(next) => setOpen(next ? "reject" : null)}
        open={open === "reject"}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void onReject()}
              size="sm"
              variant="destructive"
            >
              {busy ? "Saving..." : "Confirm reject"}
            </Button>
            <Button disabled={busy} onClick={close} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

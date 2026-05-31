import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { approveRequestItem, rejectRequestItem } from "#/server/inventory";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

interface Props {
  item: {
    id: string;
    name: string;
    status: string;
  };
  line: {
    id: string;
    status: string;
  };
}

export function AdminRequestQueueRow({ line, item }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "approve" | "reject">(null);
  const [pickupBy, setPickupBy] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = line.status === "pending";

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveRequestItem({
        data: {
          requestItemId: line.id,
          pickupBy: pickupBy ? new Date(pickupBy) : null,
        },
      });
      setMode(null);
      setPickupBy("");
      await router.invalidate();
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
        data: { requestItemId: line.id, reviewComment: reason },
      });
      setMode(null);
      setReason("");
      await router.invalidate();
    } catch (e) {
      setError((e as Error)?.message || "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.name}</p>
          <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
            <InventoryStatusBadge status={item.status as "available"} />
            <span>line: {line.status}</span>
          </div>
        </div>
        {isPending && mode === null && (
          <div className="flex gap-2">
            <Button onClick={() => setMode("approve")} size="sm">
              Approve
            </Button>
            <Button
              onClick={() => setMode("reject")}
              size="sm"
              variant="outline"
            >
              Reject
            </Button>
          </div>
        )}
      </div>

      {mode === "approve" && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label
              className="text-muted-foreground text-xs"
              htmlFor={`pickup-${line.id}`}
            >
              Pickup by (optional)
            </label>
            <Input
              className="mt-1 w-40"
              id={`pickup-${line.id}`}
              onChange={(e) => setPickupBy(e.target.value)}
              type="date"
              value={pickupBy}
            />
          </div>
          <Button disabled={busy} onClick={() => void onApprove()} size="sm">
            {busy ? "Saving..." : "Confirm approve"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setMode(null);
              setError(null);
            }}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-3 space-y-2">
          <Textarea
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (sent to requester)"
            rows={2}
            value={reason}
          />
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void onReject()}
              size="sm"
              variant="destructive"
            >
              {busy ? "Saving..." : "Confirm reject"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setMode(null);
                setError(null);
              }}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
    </div>
  );
}

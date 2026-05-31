import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  hardDeleteInventoryItem,
  transitionInventoryItem,
} from "#/server/inventory";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

type Status =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

const ALL_STATUSES: Status[] = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
];

export interface HistoryRow {
  changedByEmail: string;
  changedByName: string | null;
  comment: string | null;
  createdAt: Date | string;
  holderId: string | null;
  holderLabel: string | null;
  id: string;
  newStatus: string;
  oldStatus: string | null;
}

interface Props {
  history: HistoryRow[];
  holderName?: string | null;
  item: {
    id: string;
    name: string;
    status: string;
    currentHolderId: string | null;
    currentHolderLabel: string | null;
    currentRequestItemId: string | null;
  };
}

function recommendedNext(status: Status): {
  next: Status;
  label: string;
} | null {
  switch (status) {
    case "reserved":
      return { next: "checked_out", label: "Check out" };
    case "checked_out":
      return { next: "available", label: "Return" };
    case "requested":
      return { next: "reserved", label: "Approve / reserve" };
    case "maintenance":
      return { next: "available", label: "Mark available" };
    default:
      return null;
  }
}

const HISTORY_PAGE_SIZE = 10;

function StatusHistorySection({ history }: { history: HistoryRow[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * HISTORY_PAGE_SIZE;
  const slice = history.slice(start, start + HISTORY_PAGE_SIZE);

  return (
    <section>
      <h2 className="font-medium text-sm">Status history</h2>
      {history.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-sm">No history.</p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {slice.map((h) => (
              <li
                className="rounded-md border border-border bg-card p-3 text-sm"
                key={h.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {h.oldStatus ? `${h.oldStatus} -> ` : ""}
                    {h.newStatus}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    by {h.changedByName ?? h.changedByEmail}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(h.createdAt).toLocaleString()}
                  </span>
                </div>
                {(h.holderId || h.holderLabel) && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Holder: {h.holderLabel ?? h.holderId}
                  </p>
                )}
                {h.comment && (
                  <p className="mt-1 whitespace-pre-wrap">{h.comment}</p>
                )}
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              <span className="text-muted-foreground text-xs">
                Page {safePage} of {totalPages}
              </span>
              <Button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function InventoryLifecyclePanel({ item, holderName, history }: Props) {
  const router = useRouter();
  const status = item.status as Status;
  const rec = recommendedNext(status);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checkout / reserve dialog state
  const [dlgOpen, setDlgOpen] = useState(false);
  const [dlgTargetStatus, setDlgTargetStatus] = useState<Status>("checked_out");
  const [assignMode, setAssignMode] = useState<"user" | "label">("user");
  const [assignUserId, setAssignUserId] = useState("");
  const [assignLabel, setAssignLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [dlgComment, setDlgComment] = useState("");

  // Delete dialog state
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState("");

  // Override "change status to" select
  const [overrideStatus, setOverrideStatus] = useState<Status | "">("");

  async function runTransition(input: {
    nextStatus: Status;
    requestItemId?: string | null;
    holderId?: string | null;
    holderLabel?: string | null;
    pickupBy?: Date | null;
    dueAt?: Date | null;
    comment?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      await transitionInventoryItem({
        data: {
          itemId: item.id,
          nextStatus: input.nextStatus,
          requestItemId: input.requestItemId ?? null,
          holderId: input.holderId ?? null,
          holderLabel: input.holderLabel ?? null,
          pickupBy: input.pickupBy ?? null,
          dueAt: input.dueAt ?? null,
          comment: input.comment ?? null,
        },
      });
      await router.invalidate();
    } catch (e) {
      setError((e as Error)?.message || "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  function openDialogFor(target: Status) {
    setDlgTargetStatus(target);
    setAssignMode("user");
    setAssignUserId(item.currentHolderId ?? "");
    setAssignLabel(item.currentHolderLabel ?? "");
    setDueDate("");
    setPickupDate("");
    setDlgComment("");
    setError(null);
    setDlgOpen(true);
  }

  async function onConfirmDialog() {
    const needsHolder =
      dlgTargetStatus === "reserved" || dlgTargetStatus === "checked_out";
    if (needsHolder && !item.currentRequestItemId) {
      setError(
        "Cannot reserve / check-out from this state; there is no active request line."
      );
      return;
    }
    const holderId =
      assignMode === "user" && assignUserId ? assignUserId : null;
    const holderLabel =
      assignMode === "label" && assignLabel ? assignLabel : null;
    if (needsHolder && !holderId && !holderLabel) {
      setError("Provide a user id or a label.");
      return;
    }
    await runTransition({
      nextStatus: dlgTargetStatus,
      requestItemId: needsHolder ? item.currentRequestItemId : null,
      holderId,
      holderLabel,
      pickupBy: pickupDate ? new Date(pickupDate) : null,
      dueAt: dueDate ? new Date(dueDate) : null,
      comment: dlgComment || null,
    });
    setDlgOpen(false);
  }

  async function onRecommendedClick() {
    if (!rec) {
      return;
    }
    if (rec.next === "checked_out" || rec.next === "reserved") {
      openDialogFor(rec.next);
      return;
    }
    await runTransition({ nextStatus: rec.next });
  }

  async function onOverrideChange(v: string) {
    const next = v as Status;
    setOverrideStatus(next);
    if (next === "reserved" || next === "checked_out") {
      openDialogFor(next);
      return;
    }
    if (next === "requested") {
      setError("Cannot directly set 'requested'; use the request queue.");
      setOverrideStatus("");
      return;
    }
    await runTransition({ nextStatus: next });
    setOverrideStatus("");
  }

  async function onHardDelete() {
    setBusy(true);
    setError(null);
    try {
      await hardDeleteInventoryItem({
        data: { id: item.id, confirmName: delConfirm },
      });
      setDelOpen(false);
      // Navigate back to the list.
      window.location.href = "/admin/inventory";
    } catch (e) {
      setError((e as Error)?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const canHardDelete = status === "available" || status === "retired";
  const holderDisplay =
    holderName ??
    item.currentHolderLabel ??
    (item.currentHolderId ? "(user)" : null);

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-4">
        <p className="text-muted-foreground text-xs uppercase">Status</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <InventoryStatusBadge showRetired status={status} />
          <span className="text-muted-foreground text-xs">
            {status.replace(/_/g, " ")}
          </span>
        </div>
        {rec && (
          <div className="mt-3">
            <Button disabled={busy} onClick={onRecommendedClick} size="sm">
              {rec.label}
            </Button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="override-status">Change status to...</Label>
            <Select
              onValueChange={(v) => void onOverrideChange(v)}
              value={overrideStatus || undefined}
            >
              <SelectTrigger
                className="mt-1 w-48"
                id="override-status"
                size="sm"
              >
                <SelectValue placeholder="Pick a status" />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {error && <p className="mt-3 text-destructive text-sm">{error}</p>}
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <p className="text-muted-foreground text-xs uppercase">
          Current holder
        </p>
        <p className="mt-1 text-sm">
          {holderDisplay ? holderDisplay : "(none)"}
        </p>
      </section>

      <StatusHistorySection history={history} />

      <section className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <h2 className="font-medium text-sm">Danger zone</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Hard delete is allowed only when status is available or retired and
          the item has no historical request lines.
        </p>
        <div className="mt-2">
          <Button
            disabled={!canHardDelete || busy}
            onClick={() => {
              setDelConfirm("");
              setError(null);
              setDelOpen(true);
            }}
            size="sm"
            variant="destructive"
          >
            Hard delete item
          </Button>
        </div>
      </section>

      <Dialog onOpenChange={setDlgOpen} open={dlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dlgTargetStatus === "checked_out"
                ? "Check out item"
                : "Reserve item"}
            </DialogTitle>
            <DialogDescription>
              Assign the item to a user or to an ad-hoc label.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  checked={assignMode === "user"}
                  name="assignMode"
                  onChange={() => setAssignMode("user")}
                  type="radio"
                />
                Assign to user
              </label>
              <label className="flex items-center gap-1">
                <input
                  checked={assignMode === "label"}
                  name="assignMode"
                  onChange={() => setAssignMode("label")}
                  type="radio"
                />
                Assign to label
              </label>
            </div>
            {assignMode === "user" ? (
              <div>
                <Label htmlFor="assign-user-id">User id</Label>
                <Input
                  className="mt-1"
                  id="assign-user-id"
                  onChange={(e) => setAssignUserId(e.target.value)}
                  placeholder="User id"
                  value={assignUserId}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="assign-label">Label</Label>
                <Input
                  className="mt-1"
                  id="assign-label"
                  onChange={(e) => setAssignLabel(e.target.value)}
                  placeholder="e.g. Lab 204"
                  value={assignLabel}
                />
              </div>
            )}
            {dlgTargetStatus === "checked_out" && (
              <div>
                <Label htmlFor="due-date">Due date</Label>
                <Input
                  className="mt-1"
                  id="due-date"
                  onChange={(e) => setDueDate(e.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
            )}
            {dlgTargetStatus === "reserved" && (
              <div>
                <Label htmlFor="pickup-date">Pickup by</Label>
                <Input
                  className="mt-1"
                  id="pickup-date"
                  onChange={(e) => setPickupDate(e.target.value)}
                  type="date"
                  value={pickupDate}
                />
              </div>
            )}
            <div>
              <Label htmlFor="comment">Comment (optional)</Label>
              <Textarea
                className="mt-1"
                id="comment"
                onChange={(e) => setDlgComment(e.target.value)}
                rows={2}
                value={dlgComment}
              />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setDlgOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void onConfirmDialog()}>
              {busy ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setDelOpen} open={delOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hard delete item</DialogTitle>
            <DialogDescription>
              This permanently removes the item. Type the item name exactly to
              confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">
              Item name: <span className="font-mono">{item.name}</span>
            </p>
            <Input
              onChange={(e) => setDelConfirm(e.target.value)}
              placeholder="Type item name to confirm"
              value={delConfirm}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setDelOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || delConfirm !== item.name}
              onClick={() => void onHardDelete()}
              variant="destructive"
            >
              {busy ? "Deleting..." : "Hard delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

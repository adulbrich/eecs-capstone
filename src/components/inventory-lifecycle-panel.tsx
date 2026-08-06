import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  hardDeleteInventoryItem,
  transitionInventoryItem,
} from "#/server/inventory";
import { HolderField } from "./holder-field";
import { InventoryStatusBadge } from "./inventory-status-badge";
import { LocalTime } from "./local-time";
import { PanelSection } from "./panel";
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
  holderEmail: string | null;
  holderId: string | null;
  holderLabel: string | null;
  holderName: string | null;
  holderProgram: string | null;
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
    currentHolderName?: string | null;
    currentHolderEmail?: string | null;
    currentHolderLabel: string | null;
    currentHolderProgram?: string | null;
    currentRequestItemId: string | null;
    pickupBy?: Date | string | null;
    dueAt?: Date | string | null;
  };
}

/** `<input type="date">` speaks YYYY-MM-DD, and reads back as UTC midnight. */
function toDateInput(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * An address means the hold is on a person and carries a name/program; a
 * blank address means it is on a thing and carries a label instead. Name and
 * program are dropped once the address matches an account: the field that
 * collects them is already hidden at that point, and sending them anyway
 * would make the payload's correctness depend on `transitionItemInTx`
 * discarding them on the server, elsewhere, rather than on this file. Building
 * this in one place keeps the dialog from ever sending a combination the
 * server's invariant would reject.
 */
function holderFields({
  accountMatched,
  email,
  label,
  name,
  program,
}: {
  accountMatched: boolean;
  email: string;
  label: string;
  name: string;
  program: string;
}): {
  holderEmail: string | null;
  holderLabel: string | null;
  holderName: string | null;
  holderProgram: string | null;
} {
  const trimmedEmail = email.trim();
  // Name and program are only meaningful for an address with no account, so
  // both conditions gate them: a blank address (label mode) never sends
  // leftover text typed while the address field held something else, and a
  // matched address defers to the account's own name.
  const carriesNameAndProgram = Boolean(trimmedEmail) && !accountMatched;
  return {
    holderEmail: trimmedEmail || null,
    holderLabel: trimmedEmail ? null : label.trim() || null,
    holderName: carriesNameAndProgram ? name.trim() || null : null,
    holderProgram: carriesNameAndProgram ? program.trim() || null : null,
  };
}

function recommendedNext(status: Status): {
  next: Status;
  label: string;
} | null {
  switch (status) {
    // An available item can be handed out directly, without ever passing
    // through the request queue. Surfacing it here is what makes a walk-in
    // checkout discoverable instead of hidden behind the override select.
    case "available":
      return { next: "checked_out", label: "Check out" };
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

function formatHolderDisplay(
  item: Props["item"],
  holderName?: string | null
): string | null {
  const name = holderName ?? item.currentHolderName;
  if (item.currentHolderEmail) {
    return name
      ? `${name} (${item.currentHolderEmail})`
      : item.currentHolderEmail;
  }
  return item.currentHolderLabel ?? null;
}

const HISTORY_PAGE_SIZE = 10;

function StatusHistorySection({ history }: { history: HistoryRow[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * HISTORY_PAGE_SIZE;
  const slice = history.slice(start, start + HISTORY_PAGE_SIZE);

  return (
    <PanelSection title="Status history">
      {history.length === 0 ? (
        <p className="text-muted-foreground text-sm">No history.</p>
      ) : (
        <>
          {/* Left-rule rows, matching StatusTimeline and the project edit log.
              These used to be bordered cards, which read as many small panels
              inside a panel. */}
          <ul className="space-y-3">
            {slice.map((h) => (
              <li className="border-border border-l-2 pl-3 text-sm" key={h.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {h.oldStatus ? `${h.oldStatus} -> ` : ""}
                    {h.newStatus}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    by {h.changedByName ?? h.changedByEmail}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <LocalTime value={h.createdAt} />
                  </span>
                </div>
                {(h.holderEmail || h.holderLabel) && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Holder: {h.holderName ?? h.holderEmail ?? h.holderLabel}
                    {h.holderName && h.holderEmail ? ` (${h.holderEmail})` : ""}
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
    </PanelSection>
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
  const [assignEmail, setAssignEmail] = useState("");
  const [assignName, setAssignName] = useState("");
  const [assignProgram, setAssignProgram] = useState("");
  const [assignLabel, setAssignLabel] = useState("");
  // Whether the typed/picked address matches an existing account, reported by
  // HolderField from its own debounced lookup. The payload needs this too: an
  // account's name is authoritative, so a matched address must never carry
  // the name/program fields, and that decision should not depend on the
  // server independently re-deriving and discarding them.
  const [accountMatched, setAccountMatched] = useState(false);
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
    holderEmail?: string | null;
    holderLabel?: string | null;
    holderName?: string | null;
    holderProgram?: string | null;
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
          holderEmail: input.holderEmail ?? null,
          holderLabel: input.holderLabel ?? null,
          holderName: input.holderName ?? null,
          holderProgram: input.holderProgram ?? null,
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
    // Prefilled with whoever the item is already associated with, so a
    // reserved to checked-out step does not silently reassign the hold, and
    // a teammate's pickup starts from the requester's address rather than a
    // blank field.
    setAssignEmail(item.currentHolderEmail ?? "");
    setAssignName(item.currentHolderName ?? "");
    setAssignProgram(item.currentHolderProgram ?? "");
    setAssignLabel(item.currentHolderLabel ?? "");
    // HolderField's own lookup recomputes this from the prefilled address; it
    // just should not carry the previous dialog's result into a new one.
    setAccountMatched(false);
    setDueDate(toDateInput(item.dueAt));
    setPickupDate(toDateInput(item.pickupBy));
    setDlgComment("");
    setError(null);
    setDlgOpen(true);
  }

  async function onConfirmDialog() {
    const needsHolder =
      dlgTargetStatus === "reserved" || dlgTargetStatus === "checked_out";
    const holder = holderFields({
      accountMatched,
      email: assignEmail,
      label: assignLabel,
      name: assignName,
      program: assignProgram,
    });
    if (needsHolder && !(holder.holderEmail || holder.holderLabel)) {
      setError(
        "Enter an email address, or a label if the item is not going to a person."
      );
      return;
    }
    if (dlgTargetStatus === "checked_out" && !dueDate) {
      setError("A due date is required to check out an item.");
      return;
    }
    await runTransition({
      nextStatus: dlgTargetStatus,
      // Null when the item was never requested through a cart. Staff-assigned
      // holds are first-class, so the absence of a request line is not an
      // error; the item's own columns carry the hold.
      requestItemId: needsHolder ? item.currentRequestItemId : null,
      ...holder,
      pickupBy:
        dlgTargetStatus === "reserved" && pickupDate
          ? new Date(pickupDate)
          : null,
      dueAt:
        dlgTargetStatus === "checked_out" && dueDate ? new Date(dueDate) : null,
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
      // Client-side navigation, not `window.location.href`: this panel now
      // renders on the public item page, so a hard redirect would tear down
      // the whole SPA to leave a route the router can reach directly. The item
      // no longer exists, so the management table is the only sensible
      // destination, and only staff can reach this button.
      await router.navigate({ to: "/admin/inventory" });
    } catch (e) {
      setError((e as Error)?.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const canHardDelete = status === "available" || status === "retired";
  const holderDisplay = formatHolderDisplay(item, holderName);

  return (
    <>
      {/* Status and holder were two separate bordered cards. The holder is an
          attribute of the current status, not a peer of it, so they read as one
          section with a shared separator like the project panel's. */}
      <PanelSection title="Status">
        <dl className="grid grid-cols-3 items-center gap-2 text-sm">
          <dt className="text-muted-foreground">Current</dt>
          <dd className="col-span-2 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge showRetired status={status} />
          </dd>
          <dt className="text-muted-foreground">Holder</dt>
          <dd className="col-span-2">{holderDisplay ?? "-"}</dd>
        </dl>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          {rec && (
            <Button disabled={busy} onClick={onRecommendedClick} size="sm">
              {rec.label}
            </Button>
          )}
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
      </PanelSection>

      <StatusHistorySection history={history} />

      <PanelSection title="Danger zone" tone="danger">
        <p className="text-muted-foreground text-xs">
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
      </PanelSection>

      <Dialog onOpenChange={setDlgOpen} open={dlgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dlgTargetStatus === "checked_out"
                ? "Check out item"
                : "Reserve item"}
            </DialogTitle>
            <DialogDescription>
              Assign the item to a person by email address, or to a place or
              team by label. No prior request is needed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <HolderField
              email={assignEmail}
              label={assignLabel}
              name={assignName}
              onAccountMatchChange={setAccountMatched}
              onEmailChange={setAssignEmail}
              onLabelChange={setAssignLabel}
              onNameChange={setAssignName}
              onProgramChange={setAssignProgram}
              program={assignProgram}
            />
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
    </>
  );
}

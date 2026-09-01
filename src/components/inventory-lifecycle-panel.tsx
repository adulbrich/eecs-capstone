import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  formatHoldDetailed,
  formatHoldShort,
  holdFromStoredRow,
} from "#/lib/hold";
import { needsDueAt, needsHolder } from "#/lib/inventory-workflow";
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
  /**
   * Whether a request line has ever pointed at the item. Hard delete is
   * refused on the server while one exists, so the button is disabled here
   * for the same reason rather than after a typed confirmation.
   */
  hasRequestHistory: boolean;
  history: HistoryRow[];
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
 * An address means the hold is on a person and carries a name and program; a
 * blank address means it is on a thing and carries a label instead.
 *
 * This deliberately does **not** consult the account lookup. It used to send
 * the name and program only once the debounced lookup had answered
 * `unmatched`, and the worst case was not the one first reported. Re-saving an
 * item that already had a recorded walk-in name **erased it**: the dialog
 * opens with the name prefilled, the lookup starts at `unknown`, and a Confirm
 * inside the next 250ms sent both fields as null without the address being
 * touched at all. Reproduced in the browser, and confirmed by putting the old
 * gate back and watching a recorded name disappear.
 *
 * Note that editing the address is a different mechanism and still clears
 * these: `onHolderEmailChange` drops them on purpose, because a name typed for
 * one address must not be submitted under another.
 *
 * Deciding here was never necessary, because the server does not trust this
 * anyway: `holdFromInput` resolves the address and the `account` case of the
 * `Hold` union has nowhere to put a typed name, so one is dropped structurally
 * rather than by anyone remembering to. Sending them always and letting the
 * server decide is both simpler and the only version without a race.
 *
 * The lookup still drives whether the Name and Program inputs are on screen.
 * That is a presentation question and a stale answer there costs nothing.
 */
function holderFields({
  email,
  label,
  name,
  program,
}: {
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
  return {
    holderEmail: trimmedEmail || null,
    holderLabel: trimmedEmail ? null : label.trim() || null,
    holderName: trimmedEmail ? name.trim() || null : null,
    holderProgram: trimmedEmail ? program.trim() || null : null,
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

/**
 * The precedence (name, then address, then label) and the rule that a program
 * belongs to a person rather than to a label both live in `src/lib/hold.ts`.
 * This reads the hold off the item's columns and asks the module to render it,
 * rather than re-deriving either rule here.
 *
 * The columns arrive already reconciled against the joined account, because
 * `fullForStaff` builds them from `joinedHold`. There is nothing left for the
 * client to reconcile, which is why this takes no separate account name.
 */
function formatHolderDisplay(item: Props["item"]): string | null {
  return formatHoldDetailed(
    holdFromStoredRow({
      currentHolderId: item.currentHolderId,
      currentHolderEmail: item.currentHolderEmail ?? null,
      currentHolderLabel: item.currentHolderLabel ?? null,
      currentHolderName: item.currentHolderName ?? null,
      currentHolderProgram: item.currentHolderProgram ?? null,
    })
  );
}

/**
 * A history row records the same hold under its own column names. Mapping it
 * back onto the Hold shape is what lets this list share the precedence order
 * with the item panel instead of restating it.
 */
function holdOfHistoryRow(h: HistoryRow) {
  return holdFromStoredRow({
    currentHolderId: h.holderId,
    currentHolderEmail: h.holderEmail,
    currentHolderLabel: h.holderLabel,
    currentHolderName: h.holderName,
    currentHolderProgram: h.holderProgram,
  });
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
                    {/* The precedence comes from the Hold module; the two
                        suffixes are this list's own format, and a history row
                        shows a program even beside a label, which the item
                        panel above does not. */}
                    Holder: {formatHoldShort(holdOfHistoryRow(h))}
                    {h.holderName && h.holderEmail ? ` (${h.holderEmail})` : ""}
                    {h.holderProgram ? ` · ${h.holderProgram}` : ""}
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

export function InventoryLifecyclePanel({
  item,
  history,
  hasRequestHistory,
}: Props) {
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
  // The address the name and program on screen were entered for. Name and
  // program describe one particular person, so they cannot outlive the
  // address they belong to: staff who open a request prefilled with the
  // requester and then type a teammate's address must not be left holding
  // the requester's details under the teammate's name.
  const holderDetailsAddress = useRef("");
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
    // The prefilled name and program describe the prefilled address, so that
    // is the address they are recorded against.
    holderDetailsAddress.current = (item.currentHolderEmail ?? "").trim();
    // HolderField's own lookup recomputes this from the prefilled address; it
    // just should not carry the previous dialog's result into a new one.
    setDueDate(toDateInput(item.dueAt));
    setPickupDate(toDateInput(item.pickupBy));
    setDlgComment("");
    setError(null);
    setDlgOpen(true);
  }

  /**
   * Name and program belong to one address. Changing the address, whether by
   * typing or by picking from the account search, therefore drops them: the
   * common case is a request prefilled with its requester, where leaving the
   * details in place would file the requester's name against the teammate
   * who actually walked in.
   */
  function onHolderEmailChange(next: string) {
    const trimmed = next.trim();
    if (trimmed !== holderDetailsAddress.current) {
      holderDetailsAddress.current = trimmed;
      setAssignName("");
      setAssignProgram("");
    }
    setAssignEmail(next);
  }

  async function onConfirmDialog() {
    const holderRequired = needsHolder(dlgTargetStatus);
    const holder = holderFields({
      email: assignEmail,
      label: assignLabel,
      name: assignName,
      program: assignProgram,
    });
    if (holderRequired && !(holder.holderEmail || holder.holderLabel)) {
      setError(
        "Enter an email address, or a label if the item is not going to a person."
      );
      return;
    }
    if (needsDueAt(dlgTargetStatus) && !dueDate) {
      setError("A due date is required to check out an item.");
      return;
    }
    await runTransition({
      nextStatus: dlgTargetStatus,
      // Null when the item was never requested through a cart. Staff-assigned
      // holds are first-class, so the absence of a request line is not an
      // error; the item's own columns carry the hold.
      requestItemId: holderRequired ? item.currentRequestItemId : null,
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

  const statusAllowsHardDelete = status === "available" || status === "retired";
  const canHardDelete = statusAllowsHardDelete && !hasRequestHistory;
  const holderDisplay = formatHolderDisplay(item);

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
            {/* `overrideStatus` straight through, never `|| undefined`.
                Radix's shouldShowPlaceholder is `value === "" || value ===
                undefined`, so the empty string still shows "Pick a status"
                while keeping the Select controlled for its whole lifetime.
                Passing undefined made it uncontrolled until the first pick,
                which React warns about on every status change. */}
            <Select
              onValueChange={(v) => void onOverrideChange(v)}
              value={overrideStatus}
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
        {hasRequestHistory && (
          <p className="mt-2 text-sm">
            This item has historical request records. Retire it instead.
          </p>
        )}
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
              onEmailChange={onHolderEmailChange}
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
              aria-label="Confirm item name"
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

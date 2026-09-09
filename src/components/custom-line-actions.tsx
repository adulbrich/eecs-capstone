import { useState } from "react";
import { isOpenCustomLine } from "#/lib/inventory-custom-workflow";
import {
  rejectCustomLine,
  startSourcingCustomLine,
  updateSourcingNote,
} from "#/server/inventory-custom";
import { FulfillCustomLineDialog } from "./fulfill-custom-line-dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Textarea } from "./ui/textarea";

export interface CustomLineForActions {
  id: string;
  name: string;
  quantity: number;
  sourcingNote: string | null;
  status: string;
}

/**
 * Start sourcing, Fulfil and Reject for one custom line, sized for a table
 * cell the way `AdminRequestActions` is, and never the word Approve: a
 * custom line has no item to reserve. Once sourcing, the first button turns
 * into Update note, the one write here that is not a transition.
 */
export function CustomLineActions({
  line,
  onDone,
}: {
  line: CustomLineForActions;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<null | "note" | "reject">(null);
  const [note, setNote] = useState(line.sourcingNote ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpenCustomLine(line.status)) {
    return <span className="text-muted-foreground">-</span>;
  }
  const sourcing = line.status === "sourcing";
  const confirmLabel = sourcing ? "Save note" : "Confirm sourcing";

  function close() {
    setOpen(null);
    setError(null);
  }

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
      onDone();
    } catch (e) {
      setError((e as Error)?.message || failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Popover
        onOpenChange={(next) => setOpen(next ? "note" : null)}
        open={open === "note"}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant={sourcing ? "outline" : "default"}>
            {sourcing ? "Update note" : "Start sourcing"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2">
          <Label htmlFor={`sourcing-note-${line.id}`}>
            {sourcing
              ? "New note (sent to requester)"
              : "Note for the requester (optional)"}
          </Label>
          <Textarea
            id={`sourcing-note-${line.id}`}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ordered from the vendor, two weeks"
            rows={3}
            value={note}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    sourcing
                      ? updateSourcingNote({
                          data: { customLineId: line.id, sourcingNote: note },
                        })
                      : startSourcingCustomLine({
                          data: {
                            customLineId: line.id,
                            sourcingNote: note.trim() ? note : null,
                          },
                        }),
                  sourcing ? "Update failed" : "Sourcing failed"
                )
              }
              size="sm"
            >
              {busy ? "Saving..." : confirmLabel}
            </Button>
            <Button disabled={busy} onClick={close} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <FulfillCustomLineDialog line={line} onDone={onDone} />

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
          <Label htmlFor={`reject-reason-${line.id}`}>
            Reason (sent to requester)
          </Label>
          <Textarea
            id={`reject-reason-${line.id}`}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            value={reason}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                if (!reason.trim()) {
                  setError("Reason required");
                  return;
                }
                void run(
                  () =>
                    rejectCustomLine({
                      data: { customLineId: line.id, outcomeNote: reason },
                    }),
                  "Reject failed"
                );
              }}
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

/**
 * The group action on a custom request: every pending line to sourcing, no
 * input. One call per line rather than a batch endpoint: sourcing takes no
 * shared value the way a pickup date is, and each line's notification
 * names its own thing.
 */
export function StartSourcingAllButton({
  lines,
  onDone,
}: {
  lines: { id: string; status: string }[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = lines.filter((line) => line.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        disabled={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              for (const line of pending) {
                await startSourcingCustomLine({
                  data: { customLineId: line.id, sourcingNote: null },
                });
              }
              onDone();
            } catch (e) {
              setError((e as Error)?.message || "Sourcing failed");
            } finally {
              setBusy(false);
            }
          })()
        }
        size="sm"
      >
        {busy ? "Saving..." : "Start sourcing all"}
      </Button>
    </div>
  );
}

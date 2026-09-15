import { useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { isOpenCustomLine } from "#/lib/inventory-custom-workflow";
import { useAction } from "#/lib/use-action";
import {
  rejectCustomLine,
  startSourcingCustomLine,
  updateSourcingNote,
} from "#/server/inventory-custom";
import { FulfillCustomLineDialog } from "./fulfill-custom-line-dialog";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
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
  requesterEmail,
}: {
  line: CustomLineForActions;
  onDone: () => Promise<void>;
  /** Emailed by Fulfil and Reject; named on the skip (#387). */
  requesterEmail: string;
}) {
  const [open, setOpen] = useState<null | "note" | "reject">(null);
  const [note, setNote] = useState(line.sourcingNote ?? "");
  const [reason, setReason] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  // Each of the three actions here fails differently and they share one
  // error slot, so the fallback comes per call rather than per hook.
  const { busy, error, run, setError } = useAction();

  if (!isOpenCustomLine(line.status)) {
    return <span className="text-muted-foreground">-</span>;
  }
  const sourcing = line.status === "sourcing";
  const confirmLabel = sourcing ? "Save note" : "Confirm sourcing";

  function close() {
    setOpen(null);
    setError(null);
  }

  function runLineAction(action: () => Promise<unknown>, failure: string) {
    return run(async () => {
      await action();
      close();
      await onDone();
    }, failure);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Popover
        onOpenChange={(next) => setOpen(next ? "note" : null)}
        open={open === "note"}
      >
        <PopoverTrigger asChild>
          <Button
            size="sm"
            type="button"
            variant={sourcing ? "outline" : "default"}
          >
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
          <FieldError message={error} />
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void runLineAction(
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
              type="button"
            >
              {busy ? "Saving..." : confirmLabel}
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

      <FulfillCustomLineDialog
        line={line}
        onDone={onDone}
        requesterEmail={requesterEmail}
      />

      <Popover
        onOpenChange={(next) => {
          setOpen(next ? "reject" : null);
          if (!next) {
            // The skip is a decision about one click.
            setSendEmail(true);
          }
        }}
        open={open === "reject"}
      >
        <PopoverTrigger asChild>
          <Button size="sm" type="button" variant="outline">
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
              onClick={() => {
                if (!reason.trim()) {
                  setError("Reason required");
                  return;
                }
                void runLineAction(
                  () =>
                    rejectCustomLine({
                      data: {
                        customLineId: line.id,
                        outcomeNote: reason,
                        sendEmail,
                      },
                    }),
                  "Reject failed"
                );
              }}
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
  onDone: () => Promise<void>;
}) {
  const { busy, error, run } = useAction({ fallback: "Sourcing failed" });
  const pending = lines.filter((line) => line.status === "pending");
  if (pending.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <FieldError message={error} />
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            let done = 0;
            try {
              for (const line of pending) {
                await startSourcingCustomLine({
                  data: { customLineId: line.id, sourcingNote: null },
                });
                done++;
              }
            } catch (e) {
              // One call per line and no transaction behind them, so a
              // failure part way through leaves the earlier lines sourcing.
              // Saying only "Sourcing failed" invited a retry that would
              // transition them twice (#410). Making this atomic is the
              // server's problem and out of scope; saying what happened is
              // not.
              const failure =
                done === 0
                  ? errorMessage(e, "Sourcing failed")
                  : `Started ${done} of ${pending.length}, then stopped: ${errorMessage(e, "sourcing failed")}`;
              throw new Error(failure, { cause: e });
            } finally {
              // Whatever went through is on the server, so the table has to
              // be refreshed even when the rest did not.
              await onDone();
            }
          })
        }
        size="sm"
        type="button"
      >
        {busy ? "Saving..." : "Start sourcing all"}
      </Button>
    </div>
  );
}

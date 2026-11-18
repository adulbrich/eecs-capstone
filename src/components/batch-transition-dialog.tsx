import { useId, useState } from "react";
import { toast } from "sonner";
import {
  BATCH_TRANSITIONS,
  type BatchCandidate,
  type BatchTarget,
  PROJECT_STATUS_LABEL,
  splitBatchCandidates,
} from "#/lib/project-workflow";
import { useAction } from "#/lib/use-action";
import { batchTransitionProjects } from "#/server/projects";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** The parts of an admin list row the dialog reads. */
export interface BatchRow extends BatchCandidate {
  id: string;
  title: string;
}

/** The words each target is said in. */
const COPY: Record<
  BatchTarget,
  { busy: string; done: string; verb: string; Verb: string }
> = {
  archived: {
    busy: "Archiving...",
    done: "archived",
    verb: "archive",
    Verb: "Archive",
  },
  published: {
    busy: "Publishing...",
    done: "published",
    verb: "publish",
    Verb: "Publish",
  },
};

function projects(count: number): string {
  return count === 1 ? "1 project" : `${count} projects`;
}

/** "4 projects in this view are not published and are left alone." */
function otherStatusLine(count: number, source: string): string {
  return count === 1
    ? `1 project in this view is not ${source} and is left alone.`
    : `${count} projects in this view are not ${source} and are left alone.`;
}

/** "2 soft-deleted projects are left alone. Restore them first." */
function softDeletedLine(count: number): string {
  return count === 1
    ? "1 soft-deleted project is left alone. Restore it first."
    : `${count} soft-deleted projects are left alone. Restore them first.`;
}

/**
 * Archives every published project, or publishes every approved one, in the
 * rows the admin list holds now (#889). The set is the view: no selection,
 * and the rows in another status or soft-deleted are counted and left alone
 * by the same split the server refuses with, so the two agree on what is
 * eligible.
 *
 * Sends exactly the ids it lists. A row that changed since the page loaded
 * makes the server refuse the whole batch and name it; the dialog then shows
 * that message, stays open with the comment kept, and reloads the view, so
 * the list it draws next is the one staff can confirm.
 */
export function BatchTransitionDialog({
  onDone,
  onOpenChange,
  open,
  rows,
  target,
}: {
  /** Reloads the view: after a batch lands, and after a refusal. */
  onDone: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  rows: readonly BatchRow[];
  target: BatchTarget;
}) {
  const commentId = useId();
  const hintId = useId();
  const [comment, setComment] = useState("");
  // A second activation in the same tick would send the batch twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run, setError } = useAction({
    fallback: `Could not ${COPY[target].verb} the projects`,
  });
  const { eligible, otherStatus, softDeleted } = splitBatchCandidates(
    rows,
    target
  );
  const source = PROJECT_STATUS_LABEL[BATCH_TRANSITIONS[target]].toLowerCase();
  const copy = COPY[target];
  const count = eligible.length;

  async function onConfirm() {
    const ids = eligible.map((row) => row.id);
    if (ids.length === 0) {
      return;
    }
    let refused = false;
    const ok = await run(async () => {
      try {
        await batchTransitionProjects({
          data: {
            ids: ids as [string, ...string[]],
            target,
            comment: comment.trim() || undefined,
          },
        });
      } catch (err) {
        refused = true;
        throw err;
      }
      await onDone();
    });
    if (ok) {
      toast.success(`${projects(ids.length)} ${copy.done}.`);
      setComment("");
      onOpenChange(false);
    } else if (refused) {
      // The refusal says which rows changed; the reload draws the list
      // without them, so the next confirm sends what is true now.
      await onDone();
    }
  }

  // Every dismissal route Radix offers funnels through here, so a write in
  // flight cannot be closed out from under itself (#426).
  function onDialogOpenChange(next: boolean) {
    if (!next && busy) {
      return;
    }
    if (!next) {
      setError(null);
    }
    onOpenChange(next);
  }

  const leftAlone = (
    <>
      {otherStatus.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {otherStatusLine(otherStatus.length, source)}
        </p>
      )}
      {softDeleted.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {softDeletedLine(softDeleted.length)}
        </p>
      )}
    </>
  );

  return (
    <Dialog onOpenChange={onDialogOpenChange} open={open}>
      <DialogContent>
        {count === 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>{`No ${source} projects in this view`}</DialogTitle>
              <DialogDescription>
                {`There is nothing here to ${copy.verb}. Change the filters to show the ${source} projects you mean.`}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>{leftAlone}</DialogBody>
            <DialogFooter>
              <Button
                onClick={() => onDialogOpenChange(false)}
                type="button"
                variant="outline"
              >
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {`${copy.Verb} ${count} ${source} ${count === 1 ? "project" : "projects"}?`}
              </DialogTitle>
              <DialogDescription>
                Each proposer gets a notice in the bell, no email.
                {target === "published" &&
                  " Summaries for the published projects arrive over the next few minutes."}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              {/* Focusable so a keyboard can scroll it once it passes about
                  ten titles. */}
              <ul
                aria-label={`Projects to ${copy.verb}`}
                className="max-h-60 list-disc space-y-0.5 overflow-y-auto rounded-md border py-2 pr-2 pl-7 text-sm"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard (axe scrollable-region-focusable)
                tabIndex={0}
              >
                {eligible.map((row) => (
                  <li key={row.id}>{row.title}</li>
                ))}
              </ul>
              {leftAlone}
              <div className="space-y-1">
                <Label htmlFor={commentId}>Comment (optional)</Label>
                <Textarea
                  aria-describedby={hintId}
                  disabled={busy}
                  id={commentId}
                  maxLength={2000}
                  onChange={(event) => setComment(event.target.value)}
                  value={comment}
                />
                <p className="text-muted-foreground text-xs" id={hintId}>
                  Written to every project's status history and to each
                  proposer's bell notice.
                </p>
              </div>
              <FieldError message={error} />
            </DialogBody>
            <DialogFooter>
              <Button
                disabled={busy}
                onClick={() => onDialogOpenChange(false)}
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
                {busy ? copy.busy : `${copy.Verb} ${projects(count)}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

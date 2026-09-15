import type * as React from "react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { FieldError } from "#/components/ui/field.tsx";
import { useAction } from "#/lib/use-action.ts";

/**
 * The one destructive confirmation in the app.
 *
 * Four call sites used the native `confirm()` before this existed. That call is
 * unstyled, ignores the brand and the dark palette, blocks the main thread, and
 * is invisible to the accessibility suite, because axe cannot scan a page whose
 * script is parked on a modal browser prompt. It also cannot be reached by any
 * test we write.
 *
 * The trigger is passed as `children` and rendered through `asChild`, so the
 * call site keeps its own Button and its own variant. Nothing here decides what
 * the destructive action looks like, only what confirming it looks like.
 *
 * The dialog owns the flight, not the caller (#410). It used to call
 * `onConfirm()` without awaiting it, and `AlertDialogAction` closes on click,
 * so all six callers went through the same sequence: the confirm button never
 * disabled, never said what it was doing, and a server refusal landed in an
 * inline paragraph on the page behind a dialog that had already closed. Now
 * `onConfirm` is awaited, the dialog closes only when it resolves, and a
 * rejection is shown inside the dialog, which stays open so the reader can see
 * it and try again. A caller's handler therefore does the work and lets the
 * error propagate rather than swallowing it.
 */
export function ConfirmDialog({
  body,
  busyLabel = "Deleting...",
  children,
  confirmLabel = "Delete",
  description,
  onConfirm,
  title,
}: {
  /** Between the description and the buttons: the email skip, when the delete emails someone (#379). */
  body?: React.ReactNode;
  /** The verb plus three dots, matching the action (UI-CONVENTIONS, "Labels"). */
  busyLabel?: string;
  children: React.ReactNode;
  confirmLabel?: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  // The same hook every other trigger in the app uses. Its guard is a ref
  // read synchronously, which a `busy` state read from the render closure is
  // not: two activations in one tick both see the old `false`.
  const { busy, error, run, setError } = useAction();

  async function runConfirm() {
    if (await run(onConfirm)) {
      setOpen(false);
    }
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        // A refusal belongs to one attempt: reopening starts clean, the way
        // the send-email checkbox resets on every open.
        if (!next) {
          setError(null);
        }
        setOpen(next);
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {body}
        <FieldError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {/*
            A plain Button rather than AlertDialogAction, which closes the
            dialog on click unless the handler calls preventDefault. This one
            closes on success only, so an explicit open state is clearer than
            an opt-out (UI-CONVENTIONS, "Destructive actions"), and it is the
            shape delete-account-dialog.tsx and inventory-lifecycle-panel.tsx
            already reach for.
          */}
          <Button
            disabled={busy}
            onClick={() => void runConfirm()}
            type="button"
            variant="destructive"
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

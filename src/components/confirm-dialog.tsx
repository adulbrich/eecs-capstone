import type * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { buttonVariants } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

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
 */
export function ConfirmDialog({
  children,
  confirmLabel = "Delete",
  description,
  onConfirm,
  title,
}: {
  children: React.ReactNode;
  confirmLabel?: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  title: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => {
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

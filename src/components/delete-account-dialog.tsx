import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type DeletionPreview, deleteAccount } from "#/server/account";

// Re-exported so the profile page can type the preview it holds without a
// second import path; type-only, erased from every bundle.
export type { DeletionPreview } from "#/server/account";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * The most irreversible action in the app for the person taking it, on a
 * page they visit for ordinary reasons. So: `AlertDialog` rather than
 * `Dialog`, a typed-email gate rather than one click, and every promise the
 * privacy policy makes stated here before the button enables.
 *
 * Built on `AlertDialog` directly rather than `ConfirmDialog`, which has no
 * typed gate and closes on its action; this one has to stay open to show a
 * server refusal. Same shape as the inventory hard delete.
 *
 * `preview` is null until the server has answered. The trigger stays
 * disabled until then, because the dialog's contents are the preview: a
 * dialog that opened on defaults would promise things it had not checked.
 */
export function DeleteAccountDialog({
  onDeleted,
  preview,
}: {
  onDeleted: () => void;
  preview: DeletionPreview | null;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked =
    preview !== null &&
    (preview.blockers.items.length > 0 || preview.blockers.lastAdmin);
  const matches =
    preview !== null &&
    typed.trim().toLowerCase() === preview.email.toLowerCase();

  async function runDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount({ data: { confirmEmail: typed.trim() } });
      onDeleted();
    } catch (e) {
      setError((e as Error)?.message || "Could not delete the account");
      setBusy(false);
    }
  }

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button
          className="w-full"
          disabled={preview === null}
          type="button"
          variant="destructive"
        >
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your profile: your name, email address, affiliation,
            and interests.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview && (blocked ? <Blocked preview={preview} /> : null)}
        {preview && !blocked && (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Your projects stay published and stay readable at their existing
                URLs.
              </li>
              <li>Your name on them becomes "Deleted user".</li>
              <li>
                Contact details you typed into a project stay in that project.
              </li>
              <li>
                Records of inventory you borrowed stay, because they are
                departmental property records.
              </li>
              {preview.programs.length > 0 && (
                <li>
                  You will be removed from these programs:{" "}
                  {preview.programs
                    .map((p) => `${p.courseId} ${p.courseName}`)
                    .join(", ")}
                  .
                </li>
              )}
              <li>
                This cannot be undone.{" "}
                <strong>
                  If you sign up again we cannot link your old projects back to
                  your new account.
                </strong>
              </li>
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-email">
                Type your email address to confirm
              </Label>
              <Input
                aria-label="Confirm email"
                autoComplete="off"
                id="confirm-email"
                onChange={(e) => setTyped(e.target.value)}
                placeholder={preview.email}
                type="email"
                value={typed}
              />
            </div>
            {error && <p className="text-destructive">{error}</p>}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {!blocked && (
            <Button
              disabled={busy || !matches}
              onClick={() => void runDelete()}
              type="button"
              variant="destructive"
            >
              {busy ? "Deleting..." : "Delete my account"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The two hard preconditions, said instead of the gate. Both are things the
 * person can act on: return the item, or make someone else an admin.
 */
function Blocked({ preview }: { preview: DeletionPreview }) {
  return (
    <div className="space-y-2 text-sm">
      {preview.blockers.items.length > 0 && (
        <p>
          You still have equipment out:{" "}
          {preview.blockers.items.map((i) => i.name).join(", ")}. Return it, or
          ask staff to close the request, before deleting your account.{" "}
          <Link className="underline" to="/my/items">
            See my items
          </Link>
        </p>
      )}
      {preview.blockers.lastAdmin && (
        <p>
          You are the only admin. Make someone else an admin before deleting
          your account.
        </p>
      )}
    </div>
  );
}

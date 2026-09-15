import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { banUser, unbanUser } from "#/server/users";
import { ConfirmDialog } from "./confirm-dialog";
import { LocalTime } from "./local-time";
import { EMAIL_SKIP_HINT, SendEmailCheckbox } from "./send-email-checkbox";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface Props {
  banExpires: Date | string | null;
  banned: boolean;
  banReason: string | null;
  /** Where the ban email goes; named in the confirm so the admin can skip it (#386). */
  email: string;
  onChanged: () => void;
  userId: string;
}

/**
 * Banning signs the person out and refuses the next sign-in, so the email is
 * the only channel that can still reach them: Ban confirms through
 * `ConfirmDialog`, the destructive confirm, with the skip in its body the way
 * the project hard delete does (#386). Unban emails nobody and confirms
 * nothing.
 */
export function BanForm({
  userId,
  banned,
  banReason,
  banExpires,
  email,
  onChanged,
}: Props) {
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [sendEmail, setSendEmail] = useState(true);
  // Unban's alone. Ban is inside a ConfirmDialog, which owns its flight and
  // its refusal (#410), and the two branches never render together: this
  // component returns early on `banned`. The state used to be shared, which
  // left the Ban button reading a `busy` nothing could set.
  const { busy, error, run } = useAction({ fallback: "Unban failed" });

  async function onBan() {
    const expires = expiresAt.length > 0 ? new Date(expiresAt) : null;
    await banUser({
      data: { userId, reason, expiresAt: expires, sendEmail },
    });
    setReason("");
    setExpiresAt("");
    onChanged();
  }

  function onUnban() {
    void run(async () => {
      await unbanUser({ data: { userId } });
      onChanged();
    });
  }

  if (banned) {
    const expiresDisplay = banExpires ? (
      <LocalTime value={banExpires} />
    ) : (
      "permanent"
    );
    return (
      <section className="mt-4 rounded-md border-2 border-destructive/30 bg-destructive/5 p-3">
        <h2 className="font-medium text-sm">Banned</h2>
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">Reason: </span>
          {banReason ?? "(none)"}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">Expires: </span>
          {expiresDisplay}
        </p>
        <Button
          className="mt-3"
          disabled={busy}
          onClick={() => void onUnban()}
          size="sm"
          type="button"
          variant="outline"
        >
          {busy ? "Working..." : "Unban"}
        </Button>
        <FieldError message={error} />
      </section>
    );
  }

  return (
    <section className="mt-4">
      <h2 className="font-medium text-sm">Ban this user</h2>
      <div className="mt-2 space-y-2">
        <div>
          <Label htmlFor="ban-reason">Reason</Label>
          <Textarea
            className="mt-1"
            id="ban-reason"
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            required
            rows={3}
            value={reason}
          />
        </div>
        <div>
          <Label htmlFor="ban-expires">
            Expires at (leave blank for permanent)
          </Label>
          <Input
            className="mt-1 w-auto"
            id="ban-expires"
            onChange={(e) => setExpiresAt(e.target.value)}
            type="datetime-local"
            value={expiresAt}
          />
        </div>
        <ConfirmDialog
          body={
            <SendEmailCheckbox
              address={email}
              checked={sendEmail}
              hint={EMAIL_SKIP_HINT.emailOnly}
              onCheckedChange={setSendEmail}
            />
          }
          busyLabel="Banning..."
          confirmLabel="Ban"
          description={
            expiresAt.length > 0
              ? `${email} is signed out now and cannot sign in until ${expiresAt.replace("T", " ")}.`
              : `${email} is signed out now and cannot sign in until an admin unbans them.`
          }
          onConfirm={onBan}
          title="Ban this user?"
        >
          <Button
            disabled={reason.trim().length === 0}
            // Checked again each time the confirm opens: the skip is a
            // decision about one ban, and a Cancel must not carry it over.
            onClick={() => setSendEmail(true)}
            size="sm"
            type="button"
            variant="destructive"
          >
            Ban
          </Button>
        </ConfirmDialog>
      </div>
    </section>
  );
}

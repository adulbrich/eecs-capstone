import { useState } from "react";
import { banUser, unbanUser } from "#/server/users";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface Props {
  banExpires: Date | string | null;
  banned: boolean;
  banReason: string | null;
  onChanged: () => void;
  userId: string;
}

export function BanForm({
  userId,
  banned,
  banReason,
  banExpires,
  onChanged,
}: Props) {
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onBan() {
    setBusy(true);
    setError(null);
    try {
      const expires = expiresAt.length > 0 ? new Date(expiresAt) : null;
      await banUser({
        data: { userId, reason, expiresAt: expires },
      });
      setReason("");
      setExpiresAt("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUnban() {
    setBusy(true);
    setError(null);
    try {
      await unbanUser({ data: { userId } });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (banned) {
    const expiresDisplay = banExpires
      ? new Date(banExpires).toLocaleString()
      : "permanent";
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
        {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
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
        <Button
          disabled={busy || reason.trim().length === 0}
          onClick={() => void onBan()}
          size="sm"
          type="button"
          variant="destructive"
        >
          {busy ? "Working..." : "Ban"}
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </section>
  );
}

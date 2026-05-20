import { useState } from "react";
import { banUser, unbanUser } from "#/server/users";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type Props = {
  userId: string;
  banned: boolean;
  banReason: string | null;
  banExpires: Date | string | null;
  onChanged: () => void;
};

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
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void onUnban()}
          disabled={busy}
        >
          {busy ? "Working..." : "Unban"}
        </Button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mt-4">
      <h2 className="font-medium text-sm">Ban this user</h2>
      <div className="mt-2 space-y-2">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          required
          rows={3}
        />
        <Input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-auto"
        />
        <p className="text-xs text-muted-foreground">
          Leave expiry blank for permanent.
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => void onBan()}
          disabled={busy || reason.trim().length === 0}
        >
          {busy ? "Working..." : "Ban"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}

import { useState } from "react";
import { setUserRole } from "#/server/users";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type Role = "user" | "instructor" | "admin";

type Props = {
  userId: string;
  initialRole: Role;
  onChanged: () => void;
};

export function RoleSelect({ userId, initialRole, onChanged }: Props) {
  const [role, setRole] = useState<Role>(initialRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await setUserRole({ data: { userId, role } });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = role !== initialRole;

  return (
    <div className="mt-4">
      <Label htmlFor="role-select">Role</Label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="user">user</option>
          <option value="instructor">instructor</option>
          <option value="admin">admin</option>
        </select>
        <Button
          type="button"
          size="sm"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

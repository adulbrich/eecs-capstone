import { useState } from "react";
import { setUserRole } from "#/server/users";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type Role = "user" | "instructor" | "admin";

interface Props {
  initialRole: Role;
  onChanged: () => void;
  userId: string;
}

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
        <Select onValueChange={(v) => setRole(v as Role)} value={role}>
          <SelectTrigger className="w-36" id="role-select" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="instructor">instructor</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
        <Button
          disabled={!dirty || saving}
          onClick={() => void onSave()}
          size="sm"
          type="button"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {error && <p className="mt-2 text-destructive text-sm">{error}</p>}
    </div>
  );
}

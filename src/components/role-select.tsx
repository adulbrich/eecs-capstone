import { useState } from "react";
import { setUserRole } from "#/server/users";

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
      <label
        htmlFor="role-select"
        className="block text-xs font-medium text-neutral-500"
      >
        Role
      </label>
      <div className="mt-1 flex items-center gap-2">
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="border bg-white p-2 text-sm dark:bg-neutral-900"
        >
          <option value="user">user</option>
          <option value="instructor">instructor</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || saving}
          className="bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

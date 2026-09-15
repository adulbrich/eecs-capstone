import { useState } from "react";
import { useAction } from "#/lib/use-action";
import { USER_ROLES, type UserRole } from "#/lib/vocabularies";
import { setUserRole } from "#/server/users";
import { EMAIL_SKIP_HINT } from "./send-email-checkbox";
import { SendEmailDialog } from "./send-email-dialog";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface Props {
  /** Where the role email goes; named in the confirm so the admin can skip it (#386). */
  email: string;
  initialRole: UserRole;
  onChanged: () => void;
  userId: string;
}

/**
 * Every save here emails the person their new role, and the account has no
 * bell row for it, so Save opens the confirm with the skip rather than
 * writing straight away (#386).
 */
export function RoleSelect({ email, userId, initialRole, onChanged }: Props) {
  const [role, setRole] = useState<UserRole>(initialRole);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { busy: saving, error, run } = useAction({ fallback: "Save failed" });

  function onSave(sendEmail: boolean) {
    void run(async () => {
      await setUserRole({ data: { userId, role, sendEmail } });
      setConfirmOpen(false);
      onChanged();
    });
  }

  const dirty = role !== initialRole;

  return (
    <div className="mt-4">
      <Label htmlFor="role-select">Role</Label>
      <div className="mt-1 flex items-center gap-2">
        <Select onValueChange={(v) => setRole(v as UserRole)} value={role}>
          <SelectTrigger className="w-36" id="role-select" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {USER_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/*
          sm, not Save's usual default: the SelectTrigger it sits beside is
          sm too, and an h-9 button against an h-8 trigger is the misalignment
          the rule exists to stop (UI-CONVENTIONS, "Size follows the row").
        */}
        <Button
          disabled={!dirty || saving}
          onClick={() => setConfirmOpen(true)}
          size="sm"
          type="button"
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {!confirmOpen && <FieldError message={error} />}
      <SendEmailDialog
        address={email}
        busy={saving}
        confirmLabel="Save role"
        description={`Sets the role of ${email} to ${role}.`}
        error={error}
        hint={EMAIL_SKIP_HINT.emailOnly}
        onConfirm={(sendEmail) => void onSave(sendEmail)}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="Change the role?"
      />
    </div>
  );
}

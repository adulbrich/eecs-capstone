import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

/**
 * The line under the skip, by whether the action also writes an in-app row.
 * A transition, a reassignment and a comment do; a mentor named, a hard
 * delete, a role change and a ban reach the person by email alone.
 */
export const EMAIL_SKIP_HINT = {
  emailOnly: "Uncheck and they will not be told.",
  // A hold: the row is written for an account, and a walk-in has none.
  holder:
    "Uncheck to skip the email; a holder with an account still gets the in-app notification.",
  withBell: "Uncheck to skip the email; the in-app notification is still sent.",
} as const;

export const NO_ADDRESS_LABEL = "No address on file, no email will be sent";

/**
 * The staff skip for one email (#379): "Email <address>", checked by default,
 * with a line saying what unchecking leaves in place. Every staff action that
 * emails someone renders this inside the dialog or popover it already has, so
 * the recipient is named before the click. With no address the box is
 * disabled and says so; the server still decides who is reachable, which is
 * why the caller keeps sending `true` in that state.
 */
export function SendEmailCheckbox({
  address,
  checked,
  disabled = false,
  hint,
  onCheckedChange,
}: {
  address: string | null;
  checked: boolean;
  disabled?: boolean;
  hint: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-normal">
        <Checkbox
          checked={checked && address !== null}
          disabled={disabled || address === null}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        {address ? `Email ${address}` : NO_ADDRESS_LABEL}
      </Label>
      {address && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

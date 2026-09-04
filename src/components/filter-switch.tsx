import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  checked: boolean;
  /**
   * For a filter that cannot mean anything under the current one, so that a
   * reader cannot set a value the page would silently ignore.
   */
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * A boolean filter control for filter bars and admin toolbars.
 *
 * The `h-9` wrapper matches the height of `Input` and `SelectTrigger`, so a
 * parent using `items-end` aligns this switch with the control beside it
 * rather than with that control's label.
 *
 * `id` and `htmlFor` are required, not optional: Radix renders the switch as a
 * `button`, and a `button` nested in a `label` is not implicitly labelled.
 */
export function FilterSwitch({
  checked,
  disabled,
  id,
  label,
  onCheckedChange,
}: Props) {
  return (
    <div className="flex h-9 items-center gap-2">
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
      <Label className="font-normal" htmlFor={id}>
        {label}
      </Label>
    </div>
  );
}

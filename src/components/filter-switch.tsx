import { cn } from "#/lib/utils.ts";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  checked: boolean;
  /**
   * For a filter that cannot mean anything under the current one, so that a
   * reader cannot set a value the page would silently ignore.
   */
  disabled?: boolean;
  /**
   * One muted line under the label, for a switch whose label alone does not
   * say what it hides (#383). Wired to the switch through `aria-describedby`,
   * the way `SearchHint` is wired to its input, so a screen reader hears it
   * on focus.
   */
  hint?: string;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * A boolean filter control for filter bars and admin toolbars.
 *
 * The `h-9` wrapper matches the height of `Input` and `SelectTrigger`, so a
 * parent using `items-end` aligns this switch with the control beside it
 * rather than with that control's label. With a hint the row grows to fit
 * the second line and the switch aligns with the label's first line.
 *
 * `id` and `htmlFor` are required, not optional: Radix renders the switch as a
 * `button`, and a `button` nested in a `label` is not implicitly labelled.
 */
export function FilterSwitch({
  checked,
  disabled,
  hint,
  id,
  label,
  onCheckedChange,
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div
      className={cn(
        "flex gap-2",
        hint ? "min-h-9 items-start py-2" : "h-9 items-center"
      )}
    >
      <Switch
        aria-describedby={hintId}
        checked={checked}
        className={hint ? "mt-0.5" : undefined}
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      />
      <div>
        <Label className="font-normal" htmlFor={id}>
          {label}
        </Label>
        {hint && (
          <p className="mt-0.5 text-muted-foreground text-xs" id={hintId}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

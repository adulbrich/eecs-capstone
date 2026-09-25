import { useEffect, useState } from "react";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";

/**
 * A number field that commits only a valid value. The text the reader is
 * typing is its own state, so clearing the field to type a new number does
 * not write a blank, and a value past the bounds stays on screen, marked
 * invalid, rather than being silently clamped. A blank commits `undefined`
 * where `optional` is set, which means "use the default" on a project.
 *
 * A text input with a numeric keyboard rather than `type="number"`, which
 * reports an empty value for half-typed input like "-" in some browsers and
 * would commit a blank the reader never meant.
 */
export function NumberInput({
  integer = true,
  label,
  max,
  min,
  onCommit,
  optional = false,
  placeholder,
  value,
}: {
  integer?: boolean;
  label: string;
  max: number;
  min: number;
  onCommit: (value: number | undefined) => void;
  optional?: boolean;
  placeholder?: string;
  value: number | undefined;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);
  // The value `raw` would commit, or null when it would commit nothing.
  const accept = (raw: string): { value: number | undefined } | null => {
    if (raw.trim() === "") {
      return optional ? { value: undefined } : null;
    }
    const n = Number(raw);
    const ok =
      Number.isFinite(n) &&
      (!integer || Number.isInteger(n)) &&
      n >= min &&
      n <= max;
    return ok ? { value: n } : null;
  };
  const invalid = accept(text) === null;
  return (
    <div>
      <Input
        aria-invalid={invalid}
        aria-label={label}
        className="h-8 w-20"
        inputMode={integer ? "numeric" : "decimal"}
        onChange={(e) => {
          setText(e.target.value);
          const accepted = accept(e.target.value);
          if (accepted !== null) {
            onCommit(accepted.value);
          }
        }}
        placeholder={placeholder}
        type="text"
        value={text}
      />
      <FieldError
        message={
          invalid
            ? `${integer ? "A whole number" : "A number"} from ${min} to ${max}.`
            : null
        }
      />
    </div>
  );
}

import { useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";

/**
 * A box to paste a column copied from a spreadsheet or an email, for the
 * lists placement takes without a CSV: project titles (#664) and the class
 * roster (#665). The text stays in the box until it is used, so a typo is
 * fixed in place rather than pasted again.
 */
export function PasteList({
  buttonLabel,
  hint,
  label,
  onUse,
  placeholder,
}: {
  buttonLabel: string;
  hint: string;
  label: string;
  onUse: (text: string) => void;
  placeholder: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <p className="text-muted-foreground text-sm" id={`${id}-hint`}>
        {hint}
      </p>
      <Textarea
        aria-describedby={`${id}-hint`}
        className="min-h-32 font-mono text-sm"
        id={id}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        value={text}
      />
      <Button
        disabled={text.trim() === ""}
        onClick={() => onUse(text)}
        size="sm"
        type="button"
        variant="outline"
      >
        {buttonLabel}
      </Button>
    </div>
  );
}

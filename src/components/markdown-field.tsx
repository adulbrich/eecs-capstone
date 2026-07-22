import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useRef, useState } from "react";
import {
  applyEdit,
  buildToolbarEdit,
  type ToolbarAction,
} from "#/lib/markdown-toolbar";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface Props {
  id: string;
  name: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
}

const ACTIONS: { action: ToolbarAction; icon: typeof Bold; label: string }[] = [
  { action: "bold", icon: Bold, label: "Bold" },
  { action: "italic", icon: Italic, label: "Italic" },
  { action: "bulletList", icon: List, label: "Bullet list" },
  { action: "numberedList", icon: ListOrdered, label: "Numbered list" },
  { action: "link", icon: Link2, label: "Link" },
];

export function MarkdownField({
  id,
  name,
  onBlur,
  onChange,
  placeholder,
  rows,
  value,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  function runAction(action: ToolbarAction) {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const edit = buildToolbarEdit(
      {
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      },
      action
    );
    el.focus();
    el.setSelectionRange(edit.rangeStart, edit.rangeEnd);
    // execCommand is deprecated but is the only API that keeps the browser's
    // native undo stack intact. setRangeText is the fallback where it is
    // missing (including jsdom), at the cost of undo granularity.
    const usedExecCommand =
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, edit.replacement);
    if (!usedExecCommand) {
      el.value = applyEdit(el.value, edit);
    }
    el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    onChange(el.value);
  }

  const hintId = `${id}-markdown-hint`;

  return (
    <div className="mt-1">
      {/* biome-ignore lint/a11y/useSemanticElements: role=group with label is the right pattern for a toolbar of buttons, not a <fieldset> of form fields */}
      <div
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-1 rounded-t-md border border-input border-b-0 p-1"
        role="group"
      >
        {ACTIONS.map(({ action, icon: Icon, label }) => (
          <Button
            aria-label={label}
            disabled={mode === "preview"}
            key={action}
            onClick={() => runAction(action)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden className="size-4" />
          </Button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
            size="sm"
            type="button"
            variant={mode === "edit" ? "secondary" : "ghost"}
          >
            Edit
          </Button>
          <Button
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
            size="sm"
            type="button"
            variant={mode === "preview" ? "secondary" : "ghost"}
          >
            Preview
          </Button>
        </div>
      </div>
      {mode === "edit" ? (
        <Textarea
          aria-describedby={hintId}
          className="rounded-t-none"
          id={id}
          name={name}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          ref={textareaRef}
          rows={rows}
          value={value}
        />
      ) : (
        <div className="min-h-24 rounded-b-md border border-input p-3">
          <Markdown>{value}</Markdown>
        </div>
      )}
      <p className="mt-1 text-muted-foreground text-xs" id={hintId}>
        Markdown supported: **bold**, *italic*, - bullet lists, [links](url).
        Leave a blank line between paragraphs.
      </p>
    </div>
  );
}

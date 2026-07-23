/**
 * Pure selection arithmetic for the markdown editor toolbar.
 *
 * Returns a range replacement rather than a whole new value, because the
 * component applies it through `document.execCommand("insertText")`, which
 * preserves the browser's native undo stack. Replacing the entire textarea
 * value would discard undo history on every toolbar click.
 */
export type ToolbarAction =
  | "bold"
  | "italic"
  | "bulletList"
  | "numberedList"
  | "link";

export interface EditorState {
  selectionEnd: number;
  selectionStart: number;
  value: string;
}

export interface ToolbarEdit {
  rangeEnd: number;
  rangeStart: number;
  replacement: string;
  selectionEnd: number;
  selectionStart: number;
}

const WRAPPERS = {
  bold: { marker: "**", placeholder: "bold text" },
  italic: { marker: "*", placeholder: "italic text" },
} as const;

const LINK_TEXT_PLACEHOLDER = "link text";
const LINK_URL_PLACEHOLDER = "https://";
const LINK_PREFIX_LENGTH = 3; // "[" + text + "]("

export function applyEdit(value: string, edit: ToolbarEdit): string {
  return (
    value.slice(0, edit.rangeStart) +
    edit.replacement +
    value.slice(edit.rangeEnd)
  );
}

function wrapEdit(state: EditorState, action: "bold" | "italic"): ToolbarEdit {
  const { marker, placeholder } = WRAPPERS[action];
  const selected = state.value.slice(state.selectionStart, state.selectionEnd);
  const text = selected || placeholder;
  return {
    rangeEnd: state.selectionEnd,
    rangeStart: state.selectionStart,
    replacement: `${marker}${text}${marker}`,
    selectionEnd: state.selectionStart + marker.length + text.length,
    selectionStart: state.selectionStart + marker.length,
  };
}

function linkEdit(state: EditorState): ToolbarEdit {
  const selected = state.value.slice(state.selectionStart, state.selectionEnd);
  const text = selected || LINK_TEXT_PLACEHOLDER;
  const urlStart = state.selectionStart + text.length + LINK_PREFIX_LENGTH;
  const selectsUrl = selected.length > 0;
  return {
    rangeEnd: state.selectionEnd,
    rangeStart: state.selectionStart,
    replacement: `[${text}](${LINK_URL_PLACEHOLDER})`,
    selectionEnd: selectsUrl
      ? urlStart + LINK_URL_PLACEHOLDER.length
      : state.selectionStart + 1 + text.length,
    selectionStart: selectsUrl ? urlStart : state.selectionStart + 1,
  };
}

function listEdit(
  state: EditorState,
  action: "bulletList" | "numberedList"
): ToolbarEdit {
  const lineStart = state.value.lastIndexOf("\n", state.selectionStart - 1) + 1;
  const nextNewline = state.value.indexOf("\n", state.selectionEnd);
  const lineEnd = nextNewline === -1 ? state.value.length : nextNewline;
  const lines = state.value.slice(lineStart, lineEnd).split("\n");
  const replacement = lines
    .map((line, index) =>
      action === "bulletList" ? `- ${line}` : `${index + 1}. ${line}`
    )
    .join("\n");
  return {
    rangeEnd: lineEnd,
    rangeStart: lineStart,
    replacement,
    selectionEnd: lineStart + replacement.length,
    selectionStart: lineStart,
  };
}

export function buildToolbarEdit(
  state: EditorState,
  action: ToolbarAction
): ToolbarEdit {
  if (action === "bold" || action === "italic") {
    return wrapEdit(state, action);
  }
  if (action === "link") {
    return linkEdit(state);
  }
  return listEdit(state, action);
}

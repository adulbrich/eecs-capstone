import { describe, expect, it } from "vitest";
import {
  applyEdit,
  buildToolbarEdit,
  type EditorState,
} from "#/lib/markdown-toolbar";

function state(value: string, start: number, end = start): EditorState {
  return { value, selectionStart: start, selectionEnd: end };
}

describe("buildToolbarEdit: bold", () => {
  it("wraps the selection and keeps it selected", () => {
    const edit = buildToolbarEdit(state("the rover", 4, 9), "bold");
    expect(applyEdit("the rover", edit)).toBe("the **rover**");
    expect(edit.selectionStart).toBe(6);
    expect(edit.selectionEnd).toBe(11);
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    const edit = buildToolbarEdit(state("", 0), "bold");
    const next = applyEdit("", edit);
    expect(next).toBe("**bold text**");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      "bold text"
    );
  });
});

describe("buildToolbarEdit: italic", () => {
  it("wraps with single asterisks", () => {
    const edit = buildToolbarEdit(state("a word here", 2, 6), "italic");
    expect(applyEdit("a word here", edit)).toBe("a *word* here");
    expect(edit.selectionStart).toBe(3);
    expect(edit.selectionEnd).toBe(7);
  });
});

describe("buildToolbarEdit: link", () => {
  it("selects the url placeholder when text was selected", () => {
    const edit = buildToolbarEdit(state("docs", 0, 4), "link");
    const next = applyEdit("docs", edit);
    expect(next).toBe("[docs](https://)");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://");
  });

  it("selects the text placeholder when nothing was selected", () => {
    const edit = buildToolbarEdit(state("", 0), "link");
    const next = applyEdit("", edit);
    expect(next).toBe("[link text](https://)");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      "link text"
    );
  });
});

describe("buildToolbarEdit: lists", () => {
  it("prefixes every selected line with a bullet", () => {
    const edit = buildToolbarEdit(state("a\nb", 0, 3), "bulletList");
    expect(applyEdit("a\nb", edit)).toBe("- a\n- b");
  });

  it("numbers every selected line in order", () => {
    const edit = buildToolbarEdit(state("a\nb\nc", 0, 5), "numberedList");
    expect(applyEdit("a\nb\nc", edit)).toBe("1. a\n2. b\n3. c");
  });

  it("prefixes only the caret's line when nothing is selected", () => {
    const value = "first\nsecond\nthird";
    const edit = buildToolbarEdit(state(value, 8), "bulletList");
    expect(applyEdit(value, edit)).toBe("first\n- second\nthird");
  });

  it("leaves surrounding lines untouched", () => {
    const value = "keep\na\nb\nkeep";
    const edit = buildToolbarEdit(state(value, 5, 8), "bulletList");
    expect(applyEdit(value, edit)).toBe("keep\n- a\n- b\nkeep");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownField } from "#/components/markdown-field";

afterEach(cleanup);

function setup(value = "", onChange = vi.fn()) {
  render(
    <MarkdownField
      id="description"
      name="description"
      onBlur={() => {
        // no-op
      }}
      onChange={onChange}
      value={value}
    />
  );
  return { onChange };
}

describe("MarkdownField", () => {
  it("renders a textarea holding the raw markdown source", () => {
    setup("- one\n- two");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("- one\n- two");
  });

  it("labels every toolbar button", () => {
    setup();
    for (const name of [
      "Bold",
      "Italic",
      "Bullet list",
      "Numbered list",
      "Link",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("applies a toolbar action to the selection", () => {
    const { onChange } = setup("the rover");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(4, 9);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith("the **rover**");
  });

  // One case per remaining button. The arithmetic lives in
  // lib/markdown-toolbar.ts and has its own tests; what these check is that
  // each button is wired to its action and hands the result back. jsdom has
  // no execCommand, so the component's fallback writes the whole value.
  it.each([
    { name: "Italic", expected: "the *rover*" },
    { name: "Bullet list", expected: "- the rover" },
    { name: "Numbered list", expected: "1. the rover" },
    { name: "Link", expected: "the [rover](https://)" },
  ])("applies $name to the selection", ({ name, expected }) => {
    const { onChange } = setup("the rover");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(4, 9);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it("prefixes every selected line when making a list", () => {
    const { onChange } = setup("one\ntwo");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 7);
    fireEvent.click(screen.getByRole("button", { name: "Numbered list" }));
    expect(onChange).toHaveBeenCalledWith("1. one\n2. two");
  });

  it("inserts a placeholder link when nothing is selected", () => {
    const { onChange } = setup("");
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onChange).toHaveBeenCalledWith("[link text](https://)");
  });

  it("disables the toolbar while previewing", () => {
    setup("text");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    for (const name of ["Bold", "Italic", "Link"]) {
      expect(screen.getByRole("button", { name })).toHaveProperty(
        "disabled",
        true
      );
    }
  });

  it("switches to a rendered preview and back", () => {
    setup("- one\n- two");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelectorAll("li").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("tells the author that markdown is supported", () => {
    setup();
    expect(document.body.textContent).toContain("Markdown supported");
  });
});

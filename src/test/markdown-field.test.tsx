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

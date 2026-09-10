// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageUploader } from "#/components/image-uploader";

afterEach(cleanup);

/**
 * The uploader lives inside the project and inventory forms, where a button
 * with no `type` is a submit button. Clicking "Upload image" then opened the
 * file picker and saved the form underneath it, which on the edit page
 * navigated away to the detail page before the user had picked a file.
 */
describe("ImageUploader inside a form", () => {
  function renderInForm(currentKey: string | null) {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ImageUploader
          currentKey={currentKey}
          maxHeight={900}
          maxWidth={1600}
          onChange={() => undefined}
        />
      </form>
    );
    return onSubmit;
  }

  it("does not submit the form when Upload image is clicked", () => {
    const onSubmit = renderInForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit the form when Replace image or Remove is clicked", () => {
    const onSubmit = renderInForm("projects/x/y.webp");
    fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

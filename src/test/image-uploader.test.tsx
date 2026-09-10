// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ImageUploader } from "#/components/image-uploader";

// jsdom has no canvas. Returning null makes the crop render throw the
// component's own "Canvas 2D not supported", which the button click below is
// meant to survive; the default would log a "not implemented" error instead.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

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

  /**
   * Drives the hidden input to the crop view. The image never loads in jsdom,
   * so the `load` event is fired by hand; that is what sets the selection and
   * enables "Use image".
   */
  async function pickFile() {
    const input = document.querySelector('input[type="file"]');
    if (!input) {
      throw new Error("no file input rendered");
    }
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
        ],
      },
    });
    const image = await screen.findByRole("presentation");
    fireEvent.load(image);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Use image" }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
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

  it("does not submit the form when Use image or Cancel is clicked", async () => {
    const onSubmit = renderInForm(null);
    await pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Use image" }));
    await screen.findByText("Canvas 2D not supported");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByRole("button", { name: "Upload image" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

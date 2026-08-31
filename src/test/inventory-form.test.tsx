// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("#/components/category-multi-select", () => ({
  CategoryMultiSelect: () => null,
}));
// Renders a button rather than null, because a pending image is the only way
// to reach the upload-then-save ordering the tests below are about.
vi.mock("#/components/inventory-image-uploader", () => ({
  InventoryImageUploader: ({
    onChange,
  }: {
    onChange: (file: File | null) => void;
  }) => (
    <button
      onClick={() =>
        onChange(
          new File([new Uint8Array([1, 2, 3])], "x.webp", {
            type: "image/webp",
          })
        )
      }
      type="button"
    >
      pick image
    </button>
  ),
}));
vi.mock("#/server/inventory", () => ({
  createInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  uploadInventoryImage: vi.fn(),
}));

import { InventoryForm } from "#/components/inventory-form";
import { updateInventoryItem, uploadInventoryImage } from "#/server/inventory";

const uploadMock = uploadInventoryImage as unknown as ReturnType<typeof vi.fn>;
const updateMock = updateInventoryItem as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryForm validation", () => {
  it("shows the schema message when a required field is empty on submit", async () => {
    // End to end over the change that removed the hand-rolled safeParse loop:
    // the schema is now passed to validators.onSubmit directly, and its
    // messages have to survive the trip as Standard Schema issues.
    render(<InventoryForm />);

    // Absent first, so a string that was always on the page cannot pass this.
    expect(screen.queryByText(/Name is required/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /save|create/i }));

    await waitFor(() =>
      expect(screen.getByText(/Name is required/)).toBeTruthy()
    );
  });
});

describe("InventoryForm image ordering", () => {
  // The defect this pins: the form used to save the row and then upload, so a
  // failed upload left the edit committed and the image change never reached
  // the item's edit log. See #126, and #88 for the project-side twin.
  it("does not write the row when the upload fails", async () => {
    uploadMock.mockRejectedValue(new Error("Unsupported image type"));

    render(<InventoryForm initial={{ name: "Scope" }} itemId="item-1" />);
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    fireEvent.click(screen.getByRole("button", { name: /save|create/i }));

    await waitFor(() =>
      expect(screen.getByText(/Unsupported image type/)).toBeTruthy()
    );
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves the uploaded key as an ordinary field", async () => {
    uploadMock.mockResolvedValue({ key: "inventory/item-1/new.webp" });
    updateMock.mockResolvedValue({ id: "item-1" });

    render(<InventoryForm initial={{ name: "Scope" }} itemId="item-1" />);
    fireEvent.click(screen.getByRole("button", { name: /pick image/i }));
    fireEvent.click(screen.getByRole("button", { name: /save|create/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      id: "item-1",
      imageUrl: "inventory/item-1/new.webp",
    });
  });
});

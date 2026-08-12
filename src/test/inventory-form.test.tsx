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
vi.mock("#/components/inventory-image-uploader", () => ({
  InventoryImageUploader: () => null,
}));
vi.mock("#/server/inventory", () => ({
  createInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

import { InventoryForm } from "#/components/inventory-form";

afterEach(cleanup);

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

// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
// The project domain always mounts a CategoryTypeCombobox for the create
// control, so these are needed even for tests that never open it.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

vi.mock("#/server/categories", () => ({
  createCategory: vi.fn(),
  listCategories: vi.fn(),
}));

import { CategoryMultiSelect } from "#/components/category-multi-select";
import { createCategory, listCategories } from "#/server/categories";

const mockedList = vi.mocked(listCategories);
const mockedCreate = vi.mocked(createCategory);

const PROJECT_ROWS = [
  { id: "p1", name: "AI", type: "technology" },
  { id: "p2", name: "Healthcare", type: "industry" },
];

const INVENTORY_ROWS = [
  { id: "i1", name: "Laptop", type: null },
  { id: "i2", name: "Monitor", type: null },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CategoryMultiSelect", () => {
  it("renders project categories grouped by type", async () => {
    mockedList.mockResolvedValue({ rows: PROJECT_ROWS } as never);
    render(
      <CategoryMultiSelect
        domain="project"
        onChange={() => undefined}
        value={[]}
      />
    );
    await screen.findByText("AI");
    expect(screen.getByText("technology")).toBeTruthy();
    expect(screen.getByText("industry")).toBeTruthy();
    expect(screen.getByText("Healthcare")).toBeTruthy();
  });

  it("renders inventory categories as one flat list with no legend", async () => {
    mockedList.mockResolvedValue({ rows: INVENTORY_ROWS } as never);
    const { container } = render(
      <CategoryMultiSelect
        domain="inventory"
        onChange={() => undefined}
        value={[]}
      />
    );
    await screen.findByText("Laptop");
    expect(screen.getByText("Monitor")).toBeTruthy();
    expect(container.querySelectorAll("fieldset").length).toBe(0);
    expect(container.querySelectorAll("legend").length).toBe(0);
  });

  it("offers a create option for an unmatched name", async () => {
    mockedList.mockResolvedValue({ rows: INVENTORY_ROWS } as never);
    render(
      <CategoryMultiSelect
        domain="inventory"
        onChange={() => undefined}
        value={[]}
      />
    );
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "Projector" },
    });
    expect(await screen.findByText('Create "Projector"')).toBeTruthy();
  });

  it("offers no create option for a name that already exists", async () => {
    mockedList.mockResolvedValue({ rows: INVENTORY_ROWS } as never);
    render(
      <CategoryMultiSelect
        domain="inventory"
        onChange={() => undefined}
        value={[]}
      />
    );
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "laptop" },
    });
    expect(screen.queryByText(/^Create "/)).toBeNull();
  });

  it("creates an inventory category with domain: inventory, type: null and selects it", async () => {
    mockedList
      .mockResolvedValueOnce({ rows: INVENTORY_ROWS } as never)
      .mockResolvedValueOnce({
        rows: [...INVENTORY_ROWS, { id: "i3", name: "Projector", type: null }],
      } as never);
    mockedCreate.mockResolvedValue({ id: "i3" } as never);
    const onChange = vi.fn();
    render(
      <CategoryMultiSelect domain="inventory" onChange={onChange} value={[]} />
    );
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "Projector" },
    });
    fireEvent.click(await screen.findByText('Create "Projector"'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["i3"]));
    expect(mockedCreate).toHaveBeenCalledWith({
      data: { domain: "inventory", name: "Projector", type: null },
    });
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  // Regression test for Fix 3: the pre-fix code called setCategories([]) on
  // any load failure, including the refetch loadCategories runs again after
  // a successful create. That wiped out categories that `value` (the
  // parent's selected ids) still referenced, so a user could no longer see
  // or uncheck a selection that submit would still write. The fix keeps the
  // last-good list and surfaces the error instead.
  it("keeps the last-good list and surfaces an error when the post-create refetch fails", async () => {
    mockedList
      .mockResolvedValueOnce({ rows: INVENTORY_ROWS } as never)
      .mockRejectedValueOnce(new Error("network down"));
    mockedCreate.mockResolvedValue({ id: "i3" } as never);
    const onChange = vi.fn();
    render(
      <CategoryMultiSelect domain="inventory" onChange={onChange} value={[]} />
    );
    await screen.findByText("Laptop");
    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "Projector" },
    });
    fireEvent.click(await screen.findByText('Create "Projector"'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["i3"]));
    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
    // The stale-but-last-good rows are still visible, not wiped by the
    // failed refetch.
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Monitor")).toBeTruthy();
  });

  // Regression test for the sibling bug this codebase has already shipped
  // once (see export-csv-button.test.tsx): `err instanceof Error ? ... :`
  // must not silently render nothing when the rejection isn't an Error.
  it("still shows a visible message when the initial load rejects with a non-Error value", async () => {
    mockedList.mockRejectedValue("boom");
    render(
      <CategoryMultiSelect
        domain="inventory"
        onChange={() => undefined}
        value={[]}
      />
    );
    expect(await screen.findByText("Could not load categories")).toBeTruthy();
  });

  it("shows a starting-point create control, not a dead end, with zero categories", async () => {
    mockedList.mockResolvedValue({ rows: [] } as never);
    render(
      <CategoryMultiSelect
        domain="inventory"
        onChange={() => undefined}
        value={[]}
      />
    );
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith({ data: { domain: "inventory" } })
    );
    expect(screen.getByLabelText("Add a new category")).toBeTruthy();
    expect(screen.queryByText(/create some in/i)).toBeNull();
  });

  it("disables the project create action until a type is chosen", async () => {
    mockedList.mockResolvedValue({ rows: PROJECT_ROWS } as never);
    render(
      <CategoryMultiSelect
        domain="project"
        onChange={() => undefined}
        value={[]}
      />
    );
    await screen.findByText("AI");
    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "Robotics" },
    });
    const createButton = (await screen.findByText(
      'Create "Robotics"'
    )) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
  });

  it("creates a project category with domain: project and the chosen facet, once both are set", async () => {
    mockedList
      .mockResolvedValueOnce({ rows: PROJECT_ROWS } as never)
      .mockResolvedValueOnce({
        rows: [
          ...PROJECT_ROWS,
          { id: "p3", name: "Robotics", type: "technology" },
        ],
      } as never);
    mockedCreate.mockResolvedValue({ id: "p3" } as never);
    const onChange = vi.fn();
    render(
      <CategoryMultiSelect domain="project" onChange={onChange} value={[]} />
    );
    await screen.findByText("AI");

    fireEvent.change(screen.getByLabelText("Add a new category"), {
      target: { value: "Robotics" },
    });
    const createButton = (await screen.findByText(
      'Create "Robotics"'
    )) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);

    // Pick the existing "technology" facet from the type combobox.
    fireEvent.click(screen.getByText("Select or create a type"));
    fireEvent.click(await screen.findByRole("option", { name: "technology" }));

    await waitFor(() => expect(createButton.disabled).toBe(false));
    fireEvent.click(createButton);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["p3"]));
    expect(mockedCreate).toHaveBeenCalledWith({
      data: { domain: "project", name: "Robotics", type: "technology" },
    });
  });
});

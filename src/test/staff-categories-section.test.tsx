// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffCategoriesSection } from "#/components/staff-categories-section";
import { renderWithQueryClient } from "./shared/query-client";

const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "00000000-0000-0000-0000-0000000000p1";

const server = vi.hoisted(() => ({
  approveProposedCategory: vi.fn(),
  getProjectCategorization: vi.fn(),
  listCategoryTypes: vi.fn(),
  listProjectCategories: vi.fn(),
  regenerateProjectCategories: vi.fn(),
  setProjectCategories: vi.fn(),
}));
vi.mock("#/server/categories", () => server);
// The real picker loads the list through its own server function and has
// its own test; the draft it is handed is what these tests read.
vi.mock("#/components/category-multi-select", () => ({
  categoriesQuery: () => ({ queryKey: ["categories", "project"] }),
}));
vi.mock("#/components/project-category-picker", () => ({
  ProjectCategoryPicker: ({ value }: { value: string[] }) => (
    <output data-testid="draft">{[...value].sort().join(",")}</output>
  ),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const PROPOSAL = {
  name: "Bioacoustics",
  type: "Field",
  description: "Recording and analysing animal sounds.",
  reason: "No Field covers acoustic monitoring of whales.",
};

beforeEach(() => {
  for (const fn of Object.values(server)) {
    fn.mockReset();
  }
  server.listProjectCategories.mockResolvedValue({
    rows: [{ id: CATEGORY_ID, name: "Robotics", type: "Field" }],
  });
  server.getProjectCategorization.mockResolvedValue({
    attempt: null,
    regenerable: true,
  });
  server.listCategoryTypes.mockResolvedValue({
    types: ["Field", "Industry", "Kind of work", "Technology"],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection(onChanged = vi.fn(() => Promise.resolve())) {
  renderWithQueryClient(
    <StaffCategoriesSection onChanged={onChanged} projectId={PROJECT_ID} />
  );
  return { onChanged };
}

async function regenerateTo(categoryIds: string[], proposal = null as unknown) {
  server.regenerateProjectCategories.mockResolvedValue({
    outcome: "updated",
    categoryIds,
    proposal,
    attempt: { at: new Date(), outcome: "updated", trigger: "staff" },
    regenerable: true,
  });
  server.listProjectCategories.mockResolvedValue({
    rows: categoryIds.map((id) => ({ id, name: id, type: "Field" })),
  });
  const button = await screen.findByRole("button", {
    name: "Regenerate categories",
  });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await waitFor(() =>
    expect(server.regenerateProjectCategories).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID },
    })
  );
}

describe("the Categories section", () => {
  it("links to the Categories page instead of creating a category here", async () => {
    renderSection();

    const link = await screen.findByRole("link", {
      name: "Add or edit categories on the Categories page",
    });
    expect(link.getAttribute("href")).toBe("/admin/categories");
  });
});

describe("Regenerate categories", () => {
  it("reseeds the draft from what the server stored", async () => {
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId("draft").textContent).toBe(CATEGORY_ID)
    );

    await regenerateTo([NEW_ID]);

    await waitFor(() =>
      expect(screen.getByTestId("draft").textContent).toBe(NEW_ID)
    );
  });

  it("says nothing was replaced when a colleague's save won", async () => {
    renderSection();
    server.regenerateProjectCategories.mockResolvedValue({
      outcome: "superseded",
      categoryIds: [CATEGORY_ID],
      proposal: null,
      attempt: null,
      regenerable: true,
    });
    const button = await screen.findByRole("button", {
      name: "Regenerate categories",
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);

    expect(await screen.findByText(/nothing was replaced/u)).toBeTruthy();
  });

  it("is disabled on a deleted project, and says why", async () => {
    server.getProjectCategorization.mockResolvedValue({
      attempt: null,
      regenerable: false,
    });
    renderSection();

    expect(
      await screen.findByText(
        "Restore the project to regenerate its categories."
      )
    ).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Regenerate categories",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("shows a failed automatic attempt on a project with no categories", async () => {
    server.listProjectCategories.mockResolvedValue({ rows: [] });
    server.getProjectCategorization.mockResolvedValue({
      attempt: { at: new Date(), outcome: "failed", trigger: "automatic" },
      regenerable: true,
    });
    renderSection();

    expect(
      await screen.findByText(/Categorizing failed automatically/u)
    ).toBeTruthy();
  });
});

describe("a proposed category", () => {
  it("renders as a prefilled form with the model's reason", async () => {
    renderSection();
    await regenerateTo([CATEGORY_ID], PROPOSAL);

    const box = within(
      await screen.findByRole("region", { name: "Suggested new category" })
    );
    expect(box.getByText(PROPOSAL.reason)).toBeTruthy();
    expect((box.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Bioacoustics"
    );
    expect(
      (box.getByLabelText("Description") as HTMLTextAreaElement).value
    ).toBe(PROPOSAL.description);
  });

  it("approves through the server and adds the category to the draft", async () => {
    renderSection();
    await regenerateTo([CATEGORY_ID], PROPOSAL);
    server.approveProposedCategory.mockResolvedValue({
      categoryId: NEW_ID,
      categoryIds: [CATEGORY_ID, NEW_ID],
    });
    const box = within(
      await screen.findByRole("region", { name: "Suggested new category" })
    );
    fireEvent.change(box.getByLabelText("Name"), {
      target: { value: "Animal Acoustics" },
    });
    fireEvent.click(box.getByRole("button", { name: "Approve and add" }));

    await waitFor(() =>
      expect(server.approveProposedCategory).toHaveBeenCalledWith({
        data: {
          projectId: PROJECT_ID,
          name: "Animal Acoustics",
          type: "Field",
          description: PROPOSAL.description,
        },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("draft").textContent).toBe(
        [CATEGORY_ID, NEW_ID].sort().join(",")
      )
    );
    expect(
      screen.queryByRole("region", { name: "Suggested new category" })
    ).toBeNull();
    expect(
      screen.getByText('Added "Animal Acoustics" to Field and to this project.')
    ).toBeTruthy();
  });

  it("is dropped by Dismiss without a write", async () => {
    renderSection();
    await regenerateTo([CATEGORY_ID], PROPOSAL);
    const box = within(
      await screen.findByRole("region", { name: "Suggested new category" })
    );

    fireEvent.click(box.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByRole("region", { name: "Suggested new category" })
    ).toBeNull();
    expect(server.approveProposedCategory).not.toHaveBeenCalled();
  });
});

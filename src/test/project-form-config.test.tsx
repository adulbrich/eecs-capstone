// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/components/program-select", () => ({
  ProgramSelect: () => null,
}));
vi.mock("#/components/category-multi-select", () => ({
  CategoryMultiSelect: () => null,
}));
vi.mock("#/components/project-image-uploader", () => ({
  ProjectImageUploader: () => null,
}));
vi.mock("#/server/project-review", () => ({
  reviewProject: vi.fn(),
}));
vi.mock("#/server/projects", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("#/server/categories", () => ({
  setProjectCategories: vi.fn(),
}));
vi.mock("#/server/uploads", () => ({
  uploadProjectImage: vi.fn(),
}));
vi.mock("#/server/users", () => ({
  searchUsers: vi.fn().mockResolvedValue([]),
}));

import { ProjectForm } from "#/components/project-form";
import { PRIVATE_NOTES_LABEL } from "#/lib/private-notes";
import { FIELD_MAX_LENGTHS } from "#/lib/project-review-fields";
import { createProject } from "#/server/projects";
import { installResizeObserver } from "./radix-jsdom";

const mockedCreate = vi.mocked(createProject);

beforeAll(installResizeObserver);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Config = Partial<Parameters<typeof ProjectForm>[0] & { isStaff: boolean }>;

function renderForm(config: Config = {}) {
  render(
    <ProjectForm
      isStaff={false}
      showCategories={false}
      showNotes={false}
      submitLabel="Save"
      {...config}
    />
  );
  return screen
    .getByRole("button", { name: "Save" })
    .closest("form") as HTMLFormElement;
}

describe("ProjectForm validators", () => {
  it("refuses a description past the length the review fields declare", async () => {
    const form = renderForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A project" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "x".repeat(FIELD_MAX_LENGTHS.description + 1) },
    });
    fireEvent.submit(form);

    // Matched on the number rather than on Zod's wording: the schema gives
    // this rule no message of its own, so the sentence around it belongs to
    // Zod and changes between its versions. The limit is the rule.
    await waitFor(() =>
      expect(
        screen.getByText(new RegExp(String(FIELD_MAX_LENGTHS.description)))
      ).toBeTruthy()
    );
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("accepts a description exactly at the limit", async () => {
    mockedCreate.mockResolvedValue({ id: "p1" } as never);
    const form = renderForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A project" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "x".repeat(FIELD_MAX_LENGTHS.description) },
    });
    fireEvent.submit(form);

    await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
  });
});

describe("ProjectForm configuration props", () => {
  it("offers the AI review only when enableAiReview is set", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /Review with AI/ })).toBeNull();
    cleanup();

    renderForm({ enableAiReview: true });
    expect(screen.getByRole("button", { name: /Review with AI/ })).toBeTruthy();
  });

  it("draws the private notes field only when showNotes is set", () => {
    renderForm();
    expect(screen.queryByLabelText(PRIVATE_NOTES_LABEL)).toBeNull();
    cleanup();

    renderForm({ showNotes: true });
    expect(screen.getByLabelText(PRIVATE_NOTES_LABEL)).toBeTruthy();
  });

  it("draws the proposer picker only when showProposer is set", () => {
    renderForm();
    expect(screen.queryByLabelText("Proposer email")).toBeNull();
    expect(screen.queryByText("Staff panel")).toBeNull();
    cleanup();

    renderForm({ showProposer: true });
    expect(screen.getByLabelText("Proposer email")).toBeTruthy();
    expect(screen.getByText("Staff panel")).toBeTruthy();
  });

  it("draws the category picker only when showCategories is set", () => {
    renderForm();
    expect(screen.queryByText("Categories")).toBeNull();
    cleanup();

    renderForm({ showCategories: true });
    expect(screen.getByText("Categories")).toBeTruthy();
    expect(screen.getByText("Staff panel")).toBeTruthy();
  });

  it("keeps the staff panel out when neither staff section is shown", () => {
    renderForm({ enableAiReview: true, showNotes: true });
    expect(screen.queryByText("Staff panel")).toBeNull();
  });

  it("shows the proposer summary only alongside the picker", () => {
    const proposer = {
      accountLinked: true,
      accountName: "Sam Rivera",
      email: "sam@oregonstate.edu",
    };
    renderForm({ proposer, showCategories: true });
    expect(screen.queryByText(/Sam Rivera/)).toBeNull();
    cleanup();

    renderForm({ proposer, showProposer: true });
    expect(screen.getAllByText(/Sam Rivera/).length).toBeGreaterThan(0);
  });
});

describe("ProjectForm proposer field by role", () => {
  // The routes pass showProposer={isStaff}, so a non-staff viewer gets no
  // proposer control at all rather than a disabled one, and the form drops
  // the value on the way out too (src/test/project-form.test.tsx).
  it("gives a non-staff viewer no proposer control to edit", () => {
    renderForm({ isStaff: false, showProposer: false });
    expect(screen.queryByLabelText("Proposer email")).toBeNull();
  });

  it("gives staff an editable proposer address", () => {
    renderForm({ isStaff: true, showProposer: true });
    const input = screen.getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "sam@oregonstate.edu" } });
    expect(input.value).toBe("sam@oregonstate.edu");
  });
});

describe("ProjectForm submit button", () => {
  it("disables itself and says Saving while the save is in flight", async () => {
    let release: (value: { id: string }) => void = () => {
      // replaced synchronously below
    };
    mockedCreate.mockReturnValue(
      new Promise<{ id: string }>((resolve) => {
        release = resolve;
      }) as never
    );

    const form = renderForm();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A project" },
    });

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toHaveProperty("disabled", true);

    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "Saving..." })).toHaveProperty(
      "disabled",
      true
    );

    release({ id: "p1" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy()
    );
  });
});

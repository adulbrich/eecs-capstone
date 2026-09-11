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
vi.mock("#/server/uploads", () => ({
  uploadProjectImage: vi.fn(),
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

type Config = Partial<Parameters<typeof ProjectForm>[0]>;

function renderForm(config: Config = {}) {
  render(<ProjectForm showNotes={false} submitLabel="Save" {...config} />);
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
  it("offers no AI review without enableAiReview", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /Review with AI/ })).toBeNull();
  });

  it("offers the AI review with enableAiReview", () => {
    renderForm({ enableAiReview: true });
    expect(screen.getByRole("button", { name: /Review with AI/ })).toBeTruthy();
  });

  it("draws no private notes field without showNotes", () => {
    renderForm();
    expect(screen.queryByLabelText(PRIVATE_NOTES_LABEL)).toBeNull();
  });

  it("draws the private notes field with showNotes", () => {
    renderForm({ showNotes: true });
    expect(screen.getByLabelText(PRIVATE_NOTES_LABEL)).toBeTruthy();
  });

  it("draws no staff panel: the proposer and the categories live on the project page", () => {
    // #322 moved both staff controls to the staff panel on /projects/$id,
    // each with its own writer. The form has no prop that could bring them
    // back, so this is the one assertion the old six collapsed into.
    renderForm({ enableAiReview: true, showNotes: true });
    expect(screen.queryByText("Staff panel")).toBeNull();
    expect(screen.queryByLabelText("Proposer email")).toBeNull();
    expect(screen.queryByText("Categories")).toBeNull();
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

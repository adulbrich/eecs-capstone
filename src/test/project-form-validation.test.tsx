// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("#/server/users", () => ({
  searchUsers: vi.fn().mockResolvedValue([]),
}));

import { ProjectForm } from "#/components/project-form";

afterEach(cleanup);

function renderForm() {
  render(
    <ProjectForm
      onSubmit={vi.fn()}
      showCategories
      showNotes
      showProposer
      submitLabel="Save"
    />
  );
  // Submit the form rather than clicking Save. Once a value fails validation
  // the button is disabled, so a click stops driving anything, which is the
  // state this test exists to describe rather than work around.
  return screen
    .getByRole("button", { name: "Save" })
    .closest("form") as HTMLFormElement;
}

describe("ProjectForm validation", () => {
  it("shows the message when the proposer address is not an address", async () => {
    // The bug this guards: validation failed, canSubmit flipped false so Save
    // greyed out, and nothing said why, because this field renders
    // ProposerPicker and had no error output of its own.
    const form = renderForm();

    // Absent first, so a string that was always on the page cannot pass this.
    expect(screen.queryByText(/Must be a valid email/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A project" },
    });
    fireEvent.change(screen.getByLabelText("Proposer email"), {
      target: { value: "notanemail" },
    });
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByText(/Must be a valid email/)).toBeTruthy()
    );
  });

  it("shows the message for a field rendered through the shared helper", async () => {
    // The other half: the schema now reaches validators.onSubmit directly, so
    // its messages have to survive the trip as Standard Schema issues.
    const form = renderForm();

    expect(screen.queryByText(/Title is required/)).toBeNull();
    fireEvent.submit(form);

    await waitFor(() =>
      expect(screen.getByText(/Title is required/)).toBeTruthy()
    );
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
import { installResizeObserver } from "./radix-jsdom";

beforeAll(installResizeObserver);

afterEach(cleanup);

function renderForm() {
  render(<ProjectForm showNotes submitLabel="Save" />);
}

/**
 * The description a screen reader would read out with the field. Split on
 * whitespace because aria-describedby holds a list: a markdown field points at
 * both its description and the "Markdown supported" hint.
 */
function describedText(label: string) {
  const control = screen.getByLabelText(label);
  const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/);
  return ids
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

describe("ProjectForm field guidance", () => {
  it("gives each contact field its own privacy note", () => {
    renderForm();

    // The note used to be one sentence floating above both fields, which read
    // as page copy rather than as guidance attached to an input.
    expect(
      screen.queryByText(/Contact details below are shown publicly/)
    ).toBeNull();
    expect(describedText("Contact Name")).toBe(
      "Optional. Leave blank to keep private."
    );
    expect(describedText("Contact Email")).toBe(
      "Optional. Leave blank to keep private."
    );
  });

  it("describes the team-count field", () => {
    renderForm();

    // Shortened from "Teams this project can support", which was doing the
    // description's job in the label. The Program field left this form in
    // #450; its description is on the staff panel's section now.
    expect(describedText("Teams").length).toBeGreaterThan(0);
  });

  it("describes what every narrative field expects", () => {
    renderForm();

    for (const label of [
      "Title",
      "Description",
      "Problem Statement",
      "Objectives",
      "Minimum Qualifications",
      "Preferred Qualifications",
      "URL",
    ]) {
      // Non-empty rather than exact: the markdown fields concatenate their
      // description with the shared markdown hint.
      expect(describedText(label).length).toBeGreaterThan(0);
    }
  });
});

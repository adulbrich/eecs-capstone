// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installResizeObserver } from "./radix-jsdom";

vi.mock("#/components/project-image-uploader", () => ({
  ProjectImageUploader: () => null,
}));
vi.mock("#/server/project-review", () => ({ reviewProject: vi.fn() }));
vi.mock("#/server/projects", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("#/server/uploads", () => ({ uploadProjectImage: vi.fn() }));

import { ProjectForm } from "#/components/project-form";

installResizeObserver();
afterEach(cleanup);

function labelsInOrder(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLLabelElement>("form label")
  ).map((label) => label.textContent?.trim() ?? "");
}

/**
 * The reorder in #375: story, then contact, then terms, split by hairlines,
 * with the two short pairs side by side from `sm`. The order of
 * `buildProjectValues` on the server, which the edit log follows, is not
 * touched by any of this; `src/lib/__tests__/edit-diff.test.ts` pins it.
 */
describe("ProjectForm layout", () => {
  it("orders the fields story, contact, terms, with Title Case labels", () => {
    render(<ProjectForm showNotes submitLabel="Save" />);
    expect(labelsInOrder()).toEqual([
      "Title",
      "Description",
      "Problem Statement",
      "Objectives",
      "Minimum Qualifications",
      "Preferred Qualifications",
      "Image",
      "URL",
      "Contact Name",
      "Contact Email",
      "This project requires an NDA or IP agreement",
      "This is a sponsored project",
      "Teams",
      "Private Notes",
    ]);
  });

  it("draws three hairlines, the last only when private notes render", () => {
    const { unmount } = render(<ProjectForm showNotes submitLabel="Save" />);
    expect(document.querySelectorAll("form hr").length).toBe(3);
    unmount();
    render(<ProjectForm showNotes={false} submitLabel="Save" />);
    expect(document.querySelectorAll("form hr").length).toBe(2);
  });

  it("sets the field labels at text-base and leaves the checkbox sentences alone", () => {
    render(<ProjectForm showNotes={false} submitLabel="Save" />);
    expect(screen.getByText("Problem Statement").className).toContain(
      "text-base"
    );
    expect(screen.getByText("Teams").className).toContain("text-base");
    expect(
      screen.getByText("This is a sponsored project").className
    ).not.toContain("text-base");
  });

  // The second grid holds one field since #450 took the Program picker out of
  // this form. It stays a grid so Teams keeps the half-width column its number
  // input is sized for, rather than stretching to the form's full width.
  it("puts the contact pair in a two-column grid, and leaves Teams in its own", () => {
    render(<ProjectForm showNotes={false} submitLabel="Save" />);
    const grids = document.querySelectorAll("form .sm\\:grid-cols-2");
    expect(grids.length).toBe(2);
    expect(grids[0].textContent).toContain("Contact Name");
    expect(grids[0].textContent).toContain("Contact Email");
    expect(grids[1].textContent).toContain("Teams");
    expect(grids[1].textContent).not.toContain("Program");
  });
});

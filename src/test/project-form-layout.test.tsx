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

  // The contact pair is the only thing on this form that wants two columns.
  // Teams had a grid of its own, left behind when #450 took the Program picker
  // out, and from `sm` that wrapped its help text inside the left half with
  // the right half empty while every other field ran full width. The number
  // input carries `w-24`, which is what actually keeps it narrow.
  it("gives the contact pair the only two-column grid, and Teams the full width", () => {
    render(<ProjectForm showNotes={false} submitLabel="Save" />);
    const grids = document.querySelectorAll("form .sm\\:grid-cols-2");
    expect(grids.length).toBe(1);
    expect(grids[0].textContent).toContain("Contact Name");
    expect(grids[0].textContent).toContain("Contact Email");
    expect(grids[0].textContent).not.toContain("Teams");

    // The input stays narrow on its own, which is why the column was not
    // buying anything.
    const teams = screen.getByLabelText("Teams") as HTMLInputElement;
    expect(teams.className).toContain("w-24");
  });
});

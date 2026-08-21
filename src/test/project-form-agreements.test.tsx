// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("#/server/users", () => ({
  searchUsers: vi.fn().mockResolvedValue([]),
}));

import { ProjectForm } from "#/components/project-form";
import { installResizeObserver } from "./radix-jsdom";

beforeAll(installResizeObserver);

afterEach(cleanup);

function renderForm(initial?: Record<string, unknown>) {
  render(
    <ProjectForm
      initial={initial}
      onSubmit={vi.fn()}
      showCategories
      showNotes
      submitLabel="Save"
    />
  );
}

describe("ProjectForm NDA/IP agreement", () => {
  it("hides the restrictions textarea until the box is checked", () => {
    renderForm();

    expect(screen.queryByLabelText("Licensing / IP / NDA notes")).toBeNull();

    fireEvent.click(screen.getByLabelText(/requires an NDA or IP agreement/i));

    // The hint names the field it clears, rather than "the restrictions
    // below", which matched no label on the page.
    expect(
      screen.getByText(/Unchecking it clears Licensing\/IP\/NDA notes below\./)
    ).toBeTruthy();

    expect(screen.getByLabelText("Licensing / IP / NDA notes")).toBeTruthy();
  });

  it("shows the textarea on load for a project that already requires one", () => {
    renderForm({
      licenseRestrictions: "Signed NDA before kickoff",
      requiresNdaIp: true,
    });

    expect(screen.getByLabelText("Licensing / IP / NDA notes")).toBeTruthy();
  });
});

describe("ProjectForm sponsorship", () => {
  it("reflects an existing sponsored project", () => {
    // The round-trip guard. The edit page feeds these from the project, and
    // the server writes whatever comes back, so a checkbox that rendered
    // unchecked here would silently clear the flag on the next save.
    renderForm({ isSponsored: true });

    expect(
      (
        screen.getByLabelText(/this is a sponsored project/i) as HTMLElement
      ).getAttribute("data-state")
    ).toBe("checked");
  });
});

describe("ProjectForm commitment notice", () => {
  it("states the weekly commitment and that a student proposer needs a mentor", () => {
    renderForm();

    // A student may propose (the landing page says so) and cannot mentor their
    // own team, so the notice has to name both cases. Role cannot distinguish
    // them: a student and an industry partner are both role "user".
    expect(screen.getByText(/one hour a week/i)).toBeTruthy();
    // Specific, not /student/i: the NDA checkbox hint also says "Students",
    // and matching that would pass without the mentor sentence existing.
    expect(
      screen.getByText(/if you are a student proposing a project/i)
    ).toBeTruthy();
    expect(screen.getByText(/cannot mentor your own team/i)).toBeTruthy();
  });
});

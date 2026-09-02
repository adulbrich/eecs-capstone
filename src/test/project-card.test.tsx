// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <a {...rest}>{children}</a>
  ),
}));

import { ProjectCard, type ProjectSummary } from "#/components/project-card";
import { PROJECT_PLACEHOLDER_IMAGE } from "#/lib/project-image";

afterEach(cleanup);

const base: ProjectSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Smart Greenhouse",
  description: "A long description that should be clamped to three lines.",
  status: "published",
  seekingMentor: false,
  studentProposed: false,
  imageUrl: null,
  contactName: "Jane Doe",
  updatedAt: "2026-05-28T00:00:00.000Z",
  programCourseId: "CS-462",
  programCourseName: "Capstone",
};

describe("ProjectCard", () => {
  it("hides the status badge when published", () => {
    const { queryByText } = render(<ProjectCard project={base} />);
    expect(queryByText("published")).toBeNull();
  });

  it("shows the status badge for archived projects", () => {
    const { getByText } = render(
      <ProjectCard project={{ ...base, status: "archived" }} />
    );
    expect(getByText("archived")).toBeTruthy();
  });

  it("falls back to the default image when the project has none", () => {
    const { container } = render(<ProjectCard project={base} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      PROJECT_PLACEHOLDER_IMAGE
    );
  });

  it("prefers the project's own image when it has one", () => {
    const { container } = render(
      <ProjectCard project={{ ...base, imageUrl: "projects/a/b.webp" }} />
    );
    const src = container.querySelector("img")?.getAttribute("src");
    expect(src).not.toBe(PROJECT_PLACEHOLDER_IMAGE);
    expect(src).toContain("projects/a/b.webp");
  });

  it("renders program, contact, and updated meta", () => {
    const { container, getByText } = render(<ProjectCard project={base} />);
    expect(getByText("CS-462 Capstone · Jane Doe")).toBeTruthy();
    // The timestamp renders inside a nested <time> (see LocalTime), so the
    // paragraph's text spans elements and a whole-string matcher would miss it.
    const updated = container.querySelector("time");
    expect(updated?.getAttribute("dateTime")).toBe(base.updatedAt);
    expect(updated?.closest("p")?.textContent).toMatch(/^Updated /);
  });
});

describe("ProjectCard mentorship", () => {
  it("shows the badges when the summary carries them, and never an address", () => {
    const { getByText, queryByText } = render(
      <ProjectCard
        project={{ ...base, seekingMentor: true, studentProposed: true }}
      />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
    expect(queryByText(/@/)).toBeNull();
  });

  it("shows nothing when the summary omits them", () => {
    const { queryByText } = render(<ProjectCard project={base} />);
    expect(queryByText("Student proposed")).toBeNull();
    expect(queryByText("Seeking mentor")).toBeNull();
  });
});

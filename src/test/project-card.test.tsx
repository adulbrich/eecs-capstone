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

afterEach(cleanup);

const base: ProjectSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Smart Greenhouse",
  description: "A long description that should be clamped to three lines.",
  status: "published",
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
      <ProjectCard project={{ ...base, status: "archived" }} />,
    );
    expect(getByText("archived")).toBeTruthy();
  });

  it("renders program, contact, and updated meta", () => {
    const { getByText } = render(<ProjectCard project={base} />);
    expect(getByText("CS-462 Capstone · Jane Doe")).toBeTruthy();
    expect(getByText(/^Updated /)).toBeTruthy();
  });
});

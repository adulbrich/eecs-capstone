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

import type { ProjectSummary } from "#/components/project-card";
import { ProjectRow } from "#/components/project-row";

afterEach(cleanup);

const base: ProjectSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Rover Telemetry",
  description: "Short description.",
  status: "published",
  imageUrl: null,
  contactName: "Jane Doe",
  programCourseId: "CS 461",
  programCourseName: "Capstone",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("ProjectRow thumbnail", () => {
  it("renders the image at a fixed 3:2 ratio", () => {
    const { container } = render(
      <ProjectRow project={{ ...base, imageUrl: "projects/a/b.webp" }} />
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("aspect-[3/2]");
    expect(img?.className).not.toContain("absolute");
  });

  it("renders the fallback at the same fixed ratio", () => {
    const { container } = render(<ProjectRow project={base} />);
    expect(container.querySelector("img")).toBeNull();
    const fallback = container.querySelector('[class*="aspect-"]');
    expect(fallback?.className).toContain("aspect-[3/2]");
  });

  it("does not stretch the thumbnail to the row height", () => {
    const { container } = render(
      <ProjectRow project={{ ...base, imageUrl: "projects/a/b.webp" }} />
    );
    expect(container.querySelector(".self-stretch")).toBeNull();
  });
});

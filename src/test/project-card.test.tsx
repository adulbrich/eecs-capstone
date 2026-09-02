// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The card imports the bookmark control, which imports server functions and
// the auth client. Neither is exercised here (no provider, so no control
// renders), but the server-function import cannot resolve under jsdom.
vi.mock("#/server/bookmarks", () => ({
  addBookmark: vi.fn(),
  listMyBookmarkIds: vi.fn(),
  removeBookmark: vi.fn(),
}));
vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@tanstack/react-router", () => ({
  // `to` becomes the href so the anchor has the link role; the real Link
  // interpolates params, which no assertion here depends on.
  Link: ({
    children,
    params: _params,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
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

  it("stacks the image above the text below md and beside it from md up", () => {
    // One component for both shapes: the old card (image on top, 16:9) below
    // the breakpoint, the old row (image left, 3:2, w-40) at and above it.
    const { container } = render(<ProjectCard project={base} />);
    const img = container.querySelector("img");
    const classes = img?.className ?? "";
    expect(classes).toContain("aspect-[16/9]");
    expect(classes).toContain("w-full");
    expect(classes).toContain("md:aspect-[3/2]");
    expect(classes).toContain("md:w-40");
    expect(classes).not.toContain("self-stretch");
  });

  it("is a surface holding a link, not a link itself", () => {
    // The bookmark control is a sibling of the link (see
    // bookmark-toggle.test.tsx), so the card root cannot be the anchor.
    const { container } = render(<ProjectCard project={base} />);
    const root = container.firstElementChild;
    expect(root?.tagName).not.toBe("A");
    expect(root?.querySelector("a")?.getAttribute("href")).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
  });
});

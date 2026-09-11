// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  // Builds the href the way the real Link would, so the assertion reads as
  // the URL the user lands on rather than as a prop shape.
  Link: ({
    children,
    search,
    to,
  }: {
    children: React.ReactNode;
    search?: Record<string, string>;
    to: string;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a>
  ),
}));

import { RecommendedProjectsLink } from "#/components/recommended-projects-link";

afterEach(cleanup);

describe("RecommendedProjectsLink", () => {
  it("opens the listing ranked by interests, not column-sorted", () => {
    // `sort` is the table's column sort; the ranking the profile promises is
    // the server's `order`. The two were once confused (#323).
    render(<RecommendedProjectsLink />);
    expect(
      screen
        .getByRole("link", { name: "See your recommended projects" })
        .getAttribute("href")
    ).toBe("/projects?order=recommended");
  });
});

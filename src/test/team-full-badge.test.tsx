// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TeamFullBadge } from "#/components/team-full-badge";

afterEach(cleanup);

describe("TeamFullBadge", () => {
  it("renders for a project whose team has no room left", () => {
    render(<TeamFullBadge acceptingApplicants={false} />);
    expect(screen.getByText("Team is full")).toBeTruthy();
  });

  it("renders nothing for a project that still has openings", () => {
    const { container } = render(<TeamFullBadge acceptingApplicants />);
    expect(container.innerHTML).toBe("");
  });

  it("never says applicant, which the glossary forbids", () => {
    render(<TeamFullBadge acceptingApplicants={false} />);
    expect(screen.queryByText(/applicant/i)).toBeNull();
  });
});

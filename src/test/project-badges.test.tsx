// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectBadges } from "#/components/project-badges";

afterEach(cleanup);

const OFF = {
  requiresNdaIp: false,
  studentProposed: false,
};

describe("ProjectBadges", () => {
  it("renders nothing when no flag is set", () => {
    const { container } = render(<ProjectBadges {...OFF} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the student marker alone, and nothing about mentorship", () => {
    // Mentorship is a staff-only address since #402: no state, no badge.
    const { getByText, queryByText } = render(
      <ProjectBadges {...OFF} studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(queryByText(/mentor/i)).toBeNull();
    expect(queryByText("NDA/IP required")).toBeNull();
  });

  it("renders the agreement badge alone, in the outline style of the student marker", () => {
    const { getByText } = render(<ProjectBadges {...OFF} requiresNdaIp />);
    expect(getByText("NDA/IP required").getAttribute("data-variant")).toBe(
      "outline"
    );
    expect(getByText("NDA/IP required").getAttribute("data-variant")).toBe(
      render(<ProjectBadges {...OFF} studentProposed />)
        .getByText("Student proposed")
        .getAttribute("data-variant")
    );
  });

  it("renders children before the marks in the same row, and a row for children alone", () => {
    // The detail page passes its status and team-full badges here so the
    // page has one badge row, not two (#400).
    const { container, getByText } = render(
      <ProjectBadges {...OFF} studentProposed>
        <span>Published</span>
      </ProjectBadges>
    );
    const row = container.firstElementChild;
    expect(row?.className).toContain("flex-wrap");
    expect(row?.children[0]?.textContent).toBe("Published");
    expect(row?.children[1]?.textContent).toBe("Student proposed");
    expect(getByText("Student proposed")).toBeTruthy();
    const alone = render(
      <ProjectBadges {...OFF}>
        <span>Draft</span>
      </ProjectBadges>
    );
    expect(alone.container.textContent).toBe("Draft");
  });

  it("renders both marks in one row", () => {
    const { container, getByText } = render(
      <ProjectBadges {...OFF} requiresNdaIp studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("NDA/IP required")).toBeTruthy();
    expect(container.querySelectorAll("div").length).toBe(1);
  });

  // The count is the number of teams the project can host (#468). A badge on
  // nearly every project is the filler #434 removed two columns to be rid of,
  // so one team says nothing at all.
  it("says nothing about teams at one, or when no count is given", () => {
    const one = render(<ProjectBadges {...OFF} teamsSupported={1} />);
    expect(one.container.innerHTML).toBe("");
    const none = render(<ProjectBadges {...OFF} />);
    expect(none.container.innerHTML).toBe("");
  });

  it("renders the count above one, on its own", () => {
    // On its own: the count alone is enough to make the row exist, which is
    // the empty case the guard has to know about.
    const { getByText } = render(<ProjectBadges {...OFF} teamsSupported={3} />);
    expect(getByText("3 teams").getAttribute("data-variant")).toBe("outline");
  });

  it("puts the count after the two marks", () => {
    const { container } = render(
      <ProjectBadges
        {...OFF}
        requiresNdaIp
        studentProposed
        teamsSupported={2}
      />
    );
    const row = container.firstElementChild;
    expect(Array.from(row?.children ?? []).map((c) => c.textContent)).toEqual([
      "Student proposed",
      "NDA/IP required",
      "2 teams",
    ]);
  });
});

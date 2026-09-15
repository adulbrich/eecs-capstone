// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectBadges } from "#/components/project-badges";

afterEach(cleanup);

const OFF = {
  noMentorNeeded: false,
  requiresNdaIp: false,
  seekingMentor: false,
  studentProposed: false,
};

describe("ProjectBadges", () => {
  it("renders nothing when no flag is set", () => {
    const { container } = render(<ProjectBadges {...OFF} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the student marker alone when a mentor is on file", () => {
    const { getByText, queryByText } = render(
      <ProjectBadges {...OFF} studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(queryByText("Seeking mentor")).toBeNull();
    expect(queryByText("No mentor needed")).toBeNull();
    expect(queryByText("NDA/IP required")).toBeNull();
  });

  it("renders both mentorship badges when a student project has no mentor", () => {
    const { getByText } = render(
      <ProjectBadges {...OFF} seekingMentor studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
  });

  it("renders No mentor needed alone, in the outline style of the student marker", () => {
    const { getByText, queryByText } = render(
      <ProjectBadges {...OFF} noMentorNeeded />
    );
    expect(getByText("No mentor needed").getAttribute("data-variant")).toBe(
      "outline"
    );
    expect(queryByText("Seeking mentor")).toBeNull();
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
});

// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectBadges } from "#/components/project-badges";

afterEach(cleanup);

describe("ProjectBadges", () => {
  it("renders nothing when no flag is set", () => {
    const { container } = render(
      <ProjectBadges
        requiresNdaIp={false}
        seekingMentor={false}
        studentProposed={false}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the student marker alone when a mentor is on file", () => {
    const { getByText, queryByText } = render(
      <ProjectBadges
        requiresNdaIp={false}
        seekingMentor={false}
        studentProposed
      />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(queryByText("Seeking mentor")).toBeNull();
    expect(queryByText("NDA/IP required")).toBeNull();
  });

  it("renders both mentorship badges when a student project has no mentor", () => {
    const { getByText } = render(
      <ProjectBadges requiresNdaIp={false} seekingMentor studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
  });

  it("renders the agreement badge alone, in the outline style of the student marker", () => {
    const { getByText } = render(
      <ProjectBadges
        requiresNdaIp
        seekingMentor={false}
        studentProposed={false}
      />
    );
    const badge = getByText("NDA/IP required");
    expect(badge.getAttribute("data-variant") ?? badge.className).toBeTruthy();
  });
});

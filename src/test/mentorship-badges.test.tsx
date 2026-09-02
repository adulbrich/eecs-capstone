// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MentorshipBadges } from "#/components/mentorship-badges";

afterEach(cleanup);

describe("MentorshipBadges", () => {
  it("renders nothing when neither flag is set", () => {
    const { container } = render(
      <MentorshipBadges seekingMentor={false} studentProposed={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the student marker alone when a mentor is on file", () => {
    const { getByText, queryByText } = render(
      <MentorshipBadges seekingMentor={false} studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(queryByText("Seeking mentor")).toBeNull();
  });

  it("renders both when a student project has no mentor", () => {
    const { getByText } = render(
      <MentorshipBadges seekingMentor studentProposed />
    );
    expect(getByText("Student proposed")).toBeTruthy();
    expect(getByText("Seeking mentor")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MentorFields } from "#/components/mentor-fields";

afterEach(cleanup);

describe("MentorFields", () => {
  it("labels the switch and shows the audience note", () => {
    render(
      <MentorFields
        count={1}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants={false}
      />
    );
    expect(
      screen.getByRole("switch", { name: /want to mentor/i })
    ).toBeTruthy();
    expect(document.body.textContent).toContain(
      "For professionals and faculty, not students"
    );
  });

  it("reveals the team-count field only when opted in", () => {
    const { rerender } = render(
      <MentorFields
        count={1}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants={false}
      />
    );
    expect(screen.queryByLabelText(/how many teams/i)).toBeNull();
    rerender(
      <MentorFields
        count={2}
        onCountChange={() => {}}
        onToggle={() => {}}
        wants
      />
    );
    expect(screen.getByLabelText(/how many teams/i)).toBeTruthy();
  });
});

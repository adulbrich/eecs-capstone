// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LinkedinLine } from "#/components/linkedin-line";

afterEach(cleanup);

describe("LinkedinLine", () => {
  it("links a stored URL that passes the rule", () => {
    render(<LinkedinLine stored="https://www.linkedin.com/in/x" />);
    expect(
      screen.getByRole("link", { name: "https://www.linkedin.com/in/x" })
    ).toHaveProperty("href", "https://www.linkedin.com/in/x");
  });

  // Stored before #778, or through Better Auth's update-user before it was
  // closed: the value is still shown to staff, never as an href.
  it.each([
    "javascript:alert(1)",
    "www.linkedin.com/in/x",
    "https://a.com https://b.com",
  ])("shows %j as text, not a link", (stored) => {
    const { container } = render(<LinkedinLine stored={stored} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe(`LinkedIn: ${stored}`);
  });
});

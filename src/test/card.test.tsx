// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Card } from "#/components/ui/card";

afterEach(cleanup);

describe("Card", () => {
  it("renders the shared surface", () => {
    render(<Card>body</Card>);
    const card = screen.getByText("body");
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border-border");
    expect(card.className).toContain("bg-card");
  });

  it("adds the hover treatment only when interactive", () => {
    const { rerender } = render(<Card>plain</Card>);
    expect(screen.getByText("plain").className).not.toContain(
      "hover:border-primary"
    );
    rerender(<Card interactive>linked</Card>);
    expect(screen.getByText("linked").className).toContain(
      "hover:border-primary"
    );
  });

  it("renders as its child element when asChild is set", () => {
    render(
      <Card asChild>
        <a href="/x">link body</a>
      </Card>
    );
    const el = screen.getByText("link body");
    expect(el.tagName).toBe("A");
    expect(el.className).toContain("bg-card");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "#/components/ui/badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders its content in a consistent box", () => {
    render(<Badge>Approved</Badge>);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("inline-flex");
    expect(badge.className).toContain("rounded");
  });

  it("lets a status caller supply its own tokens", () => {
    // The reason this is not a plain cva adoption: the four badge components
    // map a domain status to a --status-* pair, which no fixed variant can say.
    render(
      <Badge
        style={{
          background: "var(--status-success-bg)",
          color: "var(--status-success)",
        }}
        variant="status"
      >
        Available
      </Badge>
    );
    const badge = screen.getByText("Available");
    expect(badge.style.color).toBe("var(--status-success)");
  });
});

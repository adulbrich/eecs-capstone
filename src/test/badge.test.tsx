// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge, badgeVariants } from "#/components/ui/badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders its content in a consistent box", () => {
    render(<Badge>Approved</Badge>);
    const badge = screen.getByText("Approved");
    expect(badge.className).toContain("inline-flex");
    expect(badge.className).toContain("rounded");
  });

  it("gives the status variant no fill of its own", () => {
    const status = badgeVariants({ variant: "status" });
    const painted = badgeVariants({ variant: "default" });
    // The design decision: `status` adopts the box and nothing else, so the
    // caller's --status-* tokens are the only thing that colors it. A variant
    // that painted would show up here.
    expect(painted).toContain("bg-secondary");
    expect(status).not.toContain("bg-");
    expect(status).not.toContain("secondary");
  });

  it("lets a status caller's tokens reach the rendered element", () => {
    // This shows the caller's inline style survives onto the DOM node. It is
    // not proof that the status variant itself paints nothing; that is
    // covered separately above by inspecting badgeVariants' output.
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

// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTime } from "#/components/local-time";

afterEach(cleanup);

const INSTANT = "2026-05-28T21:45:09.000Z";

describe("LocalTime", () => {
  it("renders the same markup on the server as on the client's first pass", () => {
    // This is the whole point of the component. If these two ever diverge,
    // React reports a hydration mismatch and discards the tree. The client
    // switches to the reader's locale in an effect, which runs after this
    // comparison would have happened.
    const server = renderToStaticMarkup(<LocalTime value={INSTANT} />);
    expect(server).toContain("2026-05-28 21:45 UTC");
    expect(server).toContain(INSTANT);
    // The fixed UTC suffix is what makes the two passes agree; without it the
    // server would emit its own timezone's rendering.
    expect(server).not.toContain(new Date(INSTANT).toLocaleString());
  });

  it("keeps the machine-readable instant in the datetime attribute", () => {
    const { container } = render(<LocalTime value={INSTANT} />);
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      INSTANT
    );
  });

  it("switches to the reader's locale after mount", () => {
    const { container } = render(<LocalTime value={INSTANT} />);
    const rendered = container.querySelector("time")?.textContent ?? "";
    expect(rendered).toBe(new Date(INSTANT).toLocaleString());
    // And it is no longer the UTC fallback, i.e. the effect actually ran.
    expect(rendered).not.toContain("UTC");
  });

  it("renders a date-only form whose visible text carries no time", () => {
    const { container } = render(<LocalTime dateOnly value={INSTANT} />);
    const el = container.querySelector("time");
    expect(el?.textContent).toBe(new Date(INSTANT).toLocaleDateString());
    expect(el?.textContent).not.toContain(":");
    // The full instant still lives in the attribute for machines.
    expect(el?.getAttribute("dateTime")).toBe(INSTANT);
  });

  it("accepts a Date object as well as a string", () => {
    const { container } = render(<LocalTime value={new Date(INSTANT)} />);
    expect(container.querySelector("time")?.getAttribute("dateTime")).toBe(
      INSTANT
    );
  });

  it("renders nothing for null, undefined, or an unparseable value", () => {
    const { container } = render(
      <>
        <LocalTime value={null} />
        <LocalTime value={undefined} />
        <LocalTime value="not a date" />
      </>
    );
    expect(container.querySelector("time")).toBeNull();
  });
});

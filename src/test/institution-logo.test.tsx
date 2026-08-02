// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InstitutionLogo } from "#/components/institution-logo";
import { brand } from "#/lib/brand";

// The source viewBox is 581.88 x 184.46667. The header renders the mark at
// 32px tall, so the declared width is 581.88 / 184.46667 * 32 = 100.94.
const EXPECTED_WIDTH = "101";
const EXPECTED_HEIGHT = "32";
const VIEWBOX_RATIO = 581.88 / 184.466_67;
const RATIO_TOLERANCE = 0.01;

afterEach(cleanup);

describe("InstitutionLogo", () => {
  it("declares intrinsic dimensions on every rendered mark", () => {
    render(<InstitutionLogo />);
    const marks = screen.getAllByAltText(brand.logoAlt);

    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.getAttribute("width")).toBe(EXPECTED_WIDTH);
      expect(mark.getAttribute("height")).toBe(EXPECTED_HEIGHT);
    }
  });

  it("declares a width matching the source viewBox ratio", () => {
    render(<InstitutionLogo />);
    const [mark] = screen.getAllByAltText(brand.logoAlt);
    const declared =
      Number(mark.getAttribute("width")) / Number(mark.getAttribute("height"));

    expect(Math.abs(declared - VIEWBOX_RATIO)).toBeLessThan(RATIO_TOLERANCE);
  });
});

import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { tabOverflow } from "#/components/tab-strip";

describe("tabOverflow", () => {
  it("says nothing of a strip that fits", () => {
    expect(
      tabOverflow({ clientWidth: 400, scrollLeft: 0, scrollWidth: 400 })
    ).toEqual({ left: false, right: false });
  });

  it("points right at the start of a strip that overflows", () => {
    expect(
      tabOverflow({ clientWidth: 343, scrollLeft: 0, scrollWidth: 480 })
    ).toEqual({ left: false, right: true });
  });

  it("points left at its end, and both ways in between", () => {
    expect(
      tabOverflow({ clientWidth: 343, scrollLeft: 137, scrollWidth: 480 })
    ).toEqual({ left: true, right: false });
    expect(
      tabOverflow({ clientWidth: 343, scrollLeft: 60, scrollWidth: 480 })
    ).toEqual({ left: true, right: true });
  });

  // Zoom leaves a fraction of a pixel at either end.
  it("ignores a subpixel remainder", () => {
    expect(
      tabOverflow({ clientWidth: 343, scrollLeft: 136.6, scrollWidth: 480 })
    ).toEqual({ left: true, right: false });
    expect(
      tabOverflow({ clientWidth: 343, scrollLeft: 0.4, scrollWidth: 480 })
    ).toEqual({ left: false, right: true });
  });

  test.prop([fc.nat(2000), fc.nat(2000)])(
    "never points either way when the content fits the box",
    (width, extra) => {
      expect(
        tabOverflow({
          clientWidth: width + extra,
          scrollLeft: 0,
          scrollWidth: width,
        })
      ).toEqual({ left: false, right: false });
    }
  );
});

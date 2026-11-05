import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { isWellFormed, trickyText } from "#/test/shared/arbitraries";
import { sliceWellFormed } from "../well-formed-cut";

describe("sliceWellFormed", () => {
  it("drops the high half of an emoji the cut split", () => {
    expect(sliceWellFormed("ab\u{1F600}", 3)).toBe("ab");
  });

  it("keeps an emoji the cut did not split", () => {
    expect(sliceWellFormed("ab\u{1F600}", 4)).toBe("ab\u{1F600}");
  });

  test.prop([trickyText(), fc.nat({ max: 80 })])(
    "is no longer than the end, well-formed, and a prefix of the input",
    (text, end) => {
      const cut = sliceWellFormed(text, end);
      expect(cut.length).toBeLessThanOrEqual(end);
      expect(isWellFormed(cut)).toBe(true);
      expect(text.startsWith(cut)).toBe(true);
    }
  );
});

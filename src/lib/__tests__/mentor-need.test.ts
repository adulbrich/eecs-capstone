import { describe, expect, it } from "vitest";
import { MENTOR_NEED_LABEL, mentorNeedRefusal } from "#/lib/mentor-need";
import { MENTOR_NEEDS } from "#/lib/vocabularies";

describe("mentorNeedRefusal", () => {
  it("allows every state without an address, and any state but none with one", () => {
    for (const saved of MENTOR_NEEDS) {
      for (const next of MENTOR_NEEDS) {
        expect(mentorNeedRefusal(saved, next, false)).toBeNull();
        if (next !== "none") {
          expect(mentorNeedRefusal(saved, next, true)).toBeNull();
        }
      }
    }
  });

  it("names the state when it was already none, and the address otherwise", () => {
    expect(mentorNeedRefusal("none", "none", true)).toBe(
      "Clear No mentor needed before recording a mentor."
    );
    for (const saved of ["unspecified", "seeking"] as const) {
      expect(mentorNeedRefusal(saved, "none", true)).toBe(
        "Remove the mentor before marking No mentor needed."
      );
    }
  });
});

describe("MENTOR_NEED_LABEL", () => {
  it("labels every state", () => {
    for (const state of MENTOR_NEEDS) {
      expect(MENTOR_NEED_LABEL[state].length).toBeGreaterThan(0);
    }
  });
});

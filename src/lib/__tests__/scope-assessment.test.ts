import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  SCOPE_RATIONALE_MAX_LENGTH,
  SCOPE_VERDICTS,
  scopeAssessmentSchema,
} from "../scope-assessment";

const valid = {
  oneTerm: "too_large",
  threeTerms: "about_right",
  confidence: 0.7,
  rationale: "Three integrations and a mobile app is more than one term.",
};

describe("scopeAssessmentSchema", () => {
  it("accepts a verdict for each length, a confidence and a rationale", () => {
    expect(scopeAssessmentSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a verdict outside the closed set", () => {
    // The model is told the enum in the tool schema; this is what makes a
    // fourth word a failure rather than a fourth badge.
    expect(
      scopeAssessmentSchema.safeParse({ ...valid, oneTerm: "just_right" })
        .success
    ).toBe(false);
    expect(SCOPE_VERDICTS).toEqual([
      "under_scoped",
      "about_right",
      "too_large",
    ]);
  });

  it("rejects a rationale over the cap, and an empty one", () => {
    const long = "x".repeat(SCOPE_RATIONALE_MAX_LENGTH + 1);
    expect(
      scopeAssessmentSchema.safeParse({ ...valid, rationale: long }).success
    ).toBe(false);
    expect(
      scopeAssessmentSchema.safeParse({ ...valid, rationale: "" }).success
    ).toBe(false);
  });

  it("keeps confidence inside 0 to 1", () => {
    expect(
      scopeAssessmentSchema.safeParse({ ...valid, confidence: 1.2 }).success
    ).toBe(false);
    expect(
      scopeAssessmentSchema.safeParse({ ...valid, confidence: -0.1 }).success
    ).toBe(false);
  });
});

describe("confidenceLabel", () => {
  it("names low confidence, which is where high uncertainty comes from", () => {
    expect(confidenceLabel(0.2)).toBe("low");
    expect(confidenceLabel(0.5)).toBe("moderate");
    expect(confidenceLabel(0.9)).toBe("high");
  });
});

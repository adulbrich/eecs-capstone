import { describe, expect, it } from "vitest";
import {
  AI_FEATURE_NOUN,
  limitsFor,
  limitVerdict,
  reviewLimits,
  scopeLimits,
} from "../ai-review-limits";

describe("the two features read their own limit pair", () => {
  const env = {
    AI_REVIEW_LIMIT_PER_HOUR: "3",
    AI_REVIEW_LIMIT_PER_DAY: "9",
    AI_SCOPE_LIMIT_PER_HOUR: "5",
    AI_SCOPE_LIMIT_PER_DAY: "7",
  } as NodeJS.ProcessEnv;

  it("keeps the review pair and the scope pair apart", () => {
    expect(reviewLimits(env)).toEqual({ perHour: 3, perDay: 9 });
    expect(scopeLimits(env)).toEqual({ perHour: 5, perDay: 7 });
    expect(limitsFor("review", env)).toEqual(reviewLimits(env));
    expect(limitsFor("scope", env)).toEqual(scopeLimits(env));
  });

  it("defaults each pair on its own", () => {
    expect(scopeLimits({} as NodeJS.ProcessEnv)).toEqual({
      perHour: 10,
      perDay: 40,
    });
  });

  it("names the feature in the refusal", () => {
    const counts = {
      inHour: 5,
      inDay: 5,
      hourResetsInMinutes: 12,
      dayResetsInMinutes: 600,
    };
    expect(
      limitVerdict(counts, scopeLimits(env), AI_FEATURE_NOUN.scope)
    ).toContain("all 5 scope assessments for this hour");
    expect(
      limitVerdict(counts, { perHour: 5, perDay: 7 }, AI_FEATURE_NOUN.review)
    ).toContain("AI reviews");
  });
});

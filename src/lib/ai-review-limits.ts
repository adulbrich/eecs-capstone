// Shared, dependency-free definitions for the AI review usage limit.
//
// This file must import nothing. The decision logic lives here rather than
// beside the queries in `server/_internal/ai-review-usage.ts` so a unit test
// can reach it without pulling in `#/db`, which throws at import time when
// DATABASE_URL is unset. CI has no .env, so a pure function behind that import
// is a test that only passes on a developer's machine.

export interface ReviewLimits {
  perDay: number;
  perHour: number;
}

export interface ReviewWindowCounts {
  /** Minutes until the oldest call in each window falls out of it. */
  dayResetsInMinutes: number;
  hourResetsInMinutes: number;
  inDay: number;
  inHour: number;
}

export type ReviewOutcome = "ok" | "truncated" | "failed";

/**
 * The paid, user-triggered features, each with its own limit pair and its own
 * rows in `ai_review_usage`. The proposal review is a proposer's writing
 * assistant; the scope assessment is staff judgement support (#61); the social
 * summary rewrite is staff correcting a preview card (#498). One limit across
 * them would make every proposer's review pay for reasoning they never see,
 * and attribute spend to the wrong feature.
 *
 * Only the staff-pressed Regenerate button meters as `social-summary`. The
 * automatic generation on publish and on edit has no user to attribute to and
 * no button to abuse, so it is not counted here at all.
 */
export type AiFeature = "review" | "scope" | "social-summary";

export const AI_FEATURE_NOUN: Record<AiFeature, string> = {
  review: "AI reviews",
  scope: "scope assessments",
  "social-summary": "social summary rewrites",
};

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and an operator can change one without a code change; both variables
 * are plumbed through `infra/ecs.tf`. `embeddingsEnabled()` is a function for
 * the first reason only: it is not plumbed, so it is not operator-facing.
 */
export function reviewLimits(
  env: NodeJS.ProcessEnv = process.env
): ReviewLimits {
  return {
    perHour: Number(env.AI_REVIEW_LIMIT_PER_HOUR ?? "10"),
    perDay: Number(env.AI_REVIEW_LIMIT_PER_DAY ?? "40"),
  };
}

export function scopeLimits(
  env: NodeJS.ProcessEnv = process.env
): ReviewLimits {
  return {
    perHour: Number(env.AI_SCOPE_LIMIT_PER_HOUR ?? "10"),
    perDay: Number(env.AI_SCOPE_LIMIT_PER_DAY ?? "40"),
  };
}

export function socialSummaryLimits(
  env: NodeJS.ProcessEnv = process.env
): ReviewLimits {
  return {
    perHour: Number(env.AI_SOCIAL_SUMMARY_LIMIT_PER_HOUR ?? "20"),
    perDay: Number(env.AI_SOCIAL_SUMMARY_LIMIT_PER_DAY ?? "60"),
  };
}

const LIMIT_READERS: Record<
  AiFeature,
  (env: NodeJS.ProcessEnv) => ReviewLimits
> = {
  review: reviewLimits,
  scope: scopeLimits,
  "social-summary": socialSummaryLimits,
};

export function limitsFor(
  feature: AiFeature,
  env: NodeJS.ProcessEnv = process.env
): ReviewLimits {
  return LIMIT_READERS[feature](env);
}

function waitPhrase(minutes: number): string {
  if (minutes <= 1) {
    return "in a minute";
  }
  if (minutes < 60) {
    return `in about ${minutes} minutes`;
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

/**
 * The decision, separated from the query so the boundaries can be tested
 * without a database. Returns the message to throw, or null to proceed.
 */
export function limitVerdict(
  counts: ReviewWindowCounts,
  limits: ReviewLimits,
  noun: string
): string | null {
  if (counts.inHour >= limits.perHour) {
    return `You have used all ${limits.perHour} ${noun} for this hour. Try again ${waitPhrase(counts.hourResetsInMinutes)}.`;
  }
  if (counts.inDay >= limits.perDay) {
    return `You have used all ${limits.perDay} ${noun} for today. Try again ${waitPhrase(counts.dayResetsInMinutes)}.`;
  }
  return null;
}

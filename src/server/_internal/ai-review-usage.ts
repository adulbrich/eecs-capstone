import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "#/db";
import { aiReviewUsage } from "#/db/schema";

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

export interface ReviewUsageRow {
  inputTokens?: number | undefined;
  model: string;
  outcome: ReviewOutcome;
  outputTokens?: number | undefined;
  projectId?: string | undefined;
  reasoningEffort: string;
  reasoningTokens?: number | undefined;
  reviewedFieldCount: number;
  userId: string;
}

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and so an operator can change one without a code change. Same reason
 * `embeddingsEnabled()` is a function.
 */
export function reviewLimits(
  env: NodeJS.ProcessEnv = process.env
): ReviewLimits {
  return {
    perHour: Number(env.AI_REVIEW_LIMIT_PER_HOUR ?? "10"),
    perDay: Number(env.AI_REVIEW_LIMIT_PER_DAY ?? "40"),
  };
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
  limits: ReviewLimits
): string | null {
  if (counts.inHour >= limits.perHour) {
    return `You have used all ${limits.perHour} AI reviews for this hour. Try again ${waitPhrase(counts.hourResetsInMinutes)}.`;
  }
  if (counts.inDay >= limits.perDay) {
    return `You have used all ${limits.perDay} AI reviews for today. Try again ${waitPhrase(counts.dayResetsInMinutes)}.`;
  }
  return null;
}

export async function countReviewsInWindows(
  userId: string
): Promise<ReviewWindowCounts> {
  const hourWindow = sql`${aiReviewUsage.createdAt} > now() - interval '1 hour'`;
  const [row] = await db
    .select({
      inHour: sql<string>`count(*) filter (where ${hourWindow})`,
      inDay: sql<string>`count(*)`,
      // How long until the oldest call in each window ages out of it. Null
      // when the window is empty, which the caller reads as zero.
      hourResetsInMinutes: sql<
        string | null
      >`extract(epoch from (min(${aiReviewUsage.createdAt}) filter (where ${hourWindow}) + interval '1 hour' - now())) / 60`,
      dayResetsInMinutes: sql<
        string | null
      >`extract(epoch from (min(${aiReviewUsage.createdAt}) + interval '1 day' - now())) / 60`,
    })
    .from(aiReviewUsage)
    // Bounding the outer query to a day keeps this on the (user_id, created_at)
    // index instead of scanning the user's whole history.
    .where(
      and(
        eq(aiReviewUsage.userId, userId),
        gt(aiReviewUsage.createdAt, sql`now() - interval '1 day'`)
      )
    );
  return {
    inHour: Number(row?.inHour ?? 0),
    inDay: Number(row?.inDay ?? 0),
    hourResetsInMinutes: Math.ceil(Number(row?.hourResetsInMinutes ?? 0)),
    dayResetsInMinutes: Math.ceil(Number(row?.dayResetsInMinutes ?? 0)),
  };
}

/**
 * Throws before any paid call happens. Two concurrent requests can both pass
 * and overshoot by one; that is bounded by concurrency and not worth a lock,
 * because this exists to stop a loop rather than to be exact.
 */
export async function assertReviewWithinLimit(userId: string): Promise<void> {
  const message = limitVerdict(
    await countReviewsInWindows(userId),
    reviewLimits()
  );
  if (message) {
    throw new Error(message);
  }
}

/**
 * Never throws into the caller. Losing a usage row degrades the limiter
 * slightly; failing the review over it degrades the product.
 */
export async function recordReviewUsage(row: ReviewUsageRow): Promise<void> {
  try {
    await db.insert(aiReviewUsage).values({
      userId: row.userId,
      projectId: row.projectId ?? null,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      inputTokens: row.inputTokens ?? null,
      reasoningTokens: row.reasoningTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      reviewedFieldCount: row.reviewedFieldCount,
      outcome: row.outcome,
    });
  } catch (error) {
    console.error(
      `Recording AI review usage failed for user ${row.userId}`,
      error
    );
  }
}

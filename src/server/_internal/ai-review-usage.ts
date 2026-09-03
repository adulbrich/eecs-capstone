import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "#/db";
import { aiReviewUsage } from "#/db/schema";
import {
  AI_FEATURE_NOUN,
  type AiFeature,
  limitsFor,
  limitVerdict,
  type ReviewOutcome,
  type ReviewWindowCounts,
} from "#/lib/ai-review-limits";

export interface ReviewUsageRow {
  feature: AiFeature;
  inputTokens?: number | undefined;
  model: string;
  outcome: ReviewOutcome;
  outputTokens?: number | undefined;
  projectId?: string | undefined;
  reasoningEffort: string;
  reasoningTokens?: number | undefined;
  reviewedFieldCount?: number | undefined;
  userId: string;
}

/**
 * Per feature, so exhausting one does not block the other: the two have
 * different cost profiles and different user counts.
 */
export async function countReviewsInWindows(
  userId: string,
  feature: AiFeature
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
        eq(aiReviewUsage.feature, feature),
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
export async function assertWithinLimit(
  userId: string,
  feature: AiFeature
): Promise<void> {
  const message = limitVerdict(
    await countReviewsInWindows(userId, feature),
    limitsFor(feature),
    AI_FEATURE_NOUN[feature]
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
      feature: row.feature,
      projectId: row.projectId ?? null,
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      inputTokens: row.inputTokens ?? null,
      reasoningTokens: row.reasoningTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      reviewedFieldCount: row.reviewedFieldCount ?? null,
      outcome: row.outcome,
    });
  } catch (error) {
    console.error(
      `Recording AI review usage failed for user ${row.userId}`,
      error
    );
  }
}

import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import {
  mantleResponses,
  type ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import {
  type RegenerateSocialSummaryResult,
  SOCIAL_SUMMARY_TOO_LONG_MESSAGE,
  type SocialSummaryView,
  socialSummaryTextSchema,
} from "#/lib/social-summary";
import {
  buildSocialSummarySource,
  socialSummaryHash,
} from "#/lib/social-summary-source";
import { assertStaff } from "#/lib/viewer";
import type {
  SaveSocialSummaryInput,
  SocialSummaryInput,
} from "../social-summary";
import { assertWithinLimit, recordReviewUsage } from "./ai-review-usage";
import { rowStillReads } from "./project-embeddings";
import { SUMMARY_GUARD_COLUMNS } from "./project-social-summary";
import {
  buildSocialSummaryConfig,
  runSocialSummary,
} from "./social-summary-core";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

const MODEL_ID = buildSocialSummaryConfig().modelId;

async function loadProject(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  return project;
}

function toView(project: typeof projects.$inferSelect): SocialSummaryView {
  return {
    summary: project.socialSummary,
    updatedAt: project.socialSummaryUpdatedAt,
    isManual: project.socialSummaryIsManual,
  };
}

export async function getSocialSummaryAs(
  viewer: AuthUser,
  data: SocialSummaryInput
): Promise<SocialSummaryView> {
  assertStaff(viewer);
  return toView(await loadProject(data.projectId));
}

export async function getSocialSummaryForCurrentUser(
  data: SocialSummaryInput
): Promise<SocialSummaryView> {
  const viewer = await requireUser();
  return getSocialSummaryAs(viewer, data);
}

/**
 * Staff write their own wording.
 *
 * Sets `socialSummaryIsManual`, which is what stops the automatic refresh on
 * the next publish or prose edit from overwriting it. The hash is left alone
 * on purpose: it records what the model last saw, and a manual row is not
 * reading it any more.
 *
 * Staff only, and the seam is where that is enforced. The panel is hidden from
 * everyone else, and a hidden panel is not a gate.
 */
export async function saveSocialSummaryAs(
  viewer: AuthUser,
  data: SaveSocialSummaryInput
): Promise<SocialSummaryView> {
  assertStaff(viewer);
  const project = await loadProject(data.projectId);
  // The same schema the `createServerFn` validator and the panel counter
  // measure with (#565), rather than a second reading of the cap here. It was
  // a second reading that let the schema accept 151 emoji and this cap reject
  // the same text at 302, so staff could be shown a summary they could not
  // save and no message that explained why.
  //
  // Parsed at the seam and not only at the validator above it: the validator
  // guards one HTTP surface and this function is what every other caller
  // reaches. Reported as a plain Error, because a ZodError's message is a JSON
  // blob and the panel renders whatever it is handed.
  //
  // Clearing is what Regenerate is for. Allowing an empty save would make a
  // blank summary reachable deliberately rather than only through an outage.
  const parsed = socialSummaryTextSchema.safeParse(data.summary);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? SOCIAL_SUMMARY_TOO_LONG_MESSAGE
    );
  }
  const summary = parsed.data;
  const updatedAt = new Date();
  await db
    .update(projects)
    .set({
      socialSummary: summary,
      socialSummaryIsManual: true,
      socialSummaryUpdatedAt: updatedAt,
    })
    .where(eq(projects.id, project.id));
  return { summary, updatedAt, isManual: true };
}

export async function saveSocialSummaryForCurrentUser(
  data: SaveSocialSummaryInput
): Promise<SocialSummaryView> {
  const viewer = await requireUser();
  return saveSocialSummaryAs(viewer, data);
}

/**
 * Staff hand the field back to the model.
 *
 * The only user-triggered model call in this feature, so the only one that
 * meters against a limit. Unlike the automatic path in
 * `project-social-summary.ts`, a failure here is thrown rather than swallowed:
 * someone pressed a button and is waiting for an answer, which is the same
 * split `refreshInterestsEmbedding` draws against the project embedding.
 *
 * Clears `socialSummaryIsManual` and writes a fresh hash, so the project
 * rejoins the automatic path from here on.
 *
 * The write is a compare-and-swap against the row this function read, because
 * the read and the write are seconds apart with a model call between them and
 * a staff save can land in the gap (#564). `refreshSocialSummary` closes the
 * same window with `socialSummaryIsManual = false` in its predicate, and that
 * predicate cannot be copied here: Regenerate exists to take a manual row back
 * from staff, so `canRegenerate` in the panel is true mostly when the flag is
 * true, and a predicate excluding manual rows would make the button a no-op in
 * its main case. Comparing the flag alone is also not enough, because staff
 * saving over staff leaves it true on both sides; it is the stored text that
 * tells those two apart. The project's own text is in the predicate too, by
 * `rowStillReads`: a summary of text the project no longer has is never
 * stored. On a published or archived project the edit has started a
 * background refresh of the newer text (ADR-0053); on any other the panel
 * says the rewrite was thrown away and staff can press it again.
 *
 * Two cases it deliberately does not catch, both benign for the same reason.
 * The automatic refresh rewriting the row with the same text it already held:
 * the predicate matches, Regenerate writes, and the wording it would have
 * preserved is the wording it overwrote. And the ABA, where the row leaves the
 * read state and comes back to it: Carol saves over Bob, Bob saves his wording
 * again, and a regenerate that read Bob's wording now writes over Bob's
 * wording. The predicate is value equality on purpose, because the question it
 * asks is "is the text I am about to replace still the text I read", not "has
 * anybody written since". Replacing wording the caller read and chose to
 * replace is what the button does; the guard exists to stop it replacing
 * wording the caller never saw.
 *
 * What neither case covers, because it is a different bug: two Saves racing
 * each other. `saveSocialSummaryAs` is last write wins and says nothing, so
 * Carol's save over Bob's is silent. That is tracked separately.
 *
 * Deliberately not `socialSummaryUpdatedAt`, which looks like the obvious
 * version column and is not one. `scripts/backfill-social-summaries.mjs`
 * writes it with SQL `now()` at microsecond precision while the app writes a
 * JS `Date` at millisecond precision, so an equality predicate on it would
 * miss on every backfilled row and report a race that never happened.
 */
export async function regenerateSocialSummaryAs(
  viewer: AuthUser,
  data: SocialSummaryInput,
  invoke: ResponsesFn = mantleResponses
): Promise<RegenerateSocialSummaryResult> {
  assertStaff(viewer);
  const project = await loadProject(data.projectId);
  const source = buildSocialSummarySource(project);
  if (!source) {
    throw new Error(
      "This project has no title, description or problem statement to summarise."
    );
  }
  await assertWithinLimit(viewer.id, "social-summary");

  const run = await runSocialSummary(source, invoke);
  // Metered on every return, as the review and the scope assessment are: a
  // failed or truncated attempt is billed all the same. Unconditional rather
  // than behind a `run.called` flag, which `runSocialSummary` always set and
  // so tested as nothing (#568).
  //
  // "Every return" is wider than "every paid call", and deliberately so. The
  // one `catch` in `runSocialSummary` wraps `invoke`, and `mantleResponses`
  // throws both when it never reached AWS (no credentials, no route) and when
  // AWS answered with a 4xx or 5xx, which is a call that may well be billed.
  // Nothing in the caught error separates the two without matching on its
  // message. Counting both is the conservative reading: over-metering costs a
  // staff member one of twenty rewrites an hour during an outage, while
  // under-metering would let a loop of failing calls run without a limit,
  // which is the thing the limiter exists to stop.
  await recordReviewUsage({
    feature: "social-summary",
    userId: viewer.id,
    projectId: project.id,
    model: run.model,
    reasoningEffort: run.reasoningEffort,
    inputTokens: run.usage?.inputTokens,
    outputTokens: run.usage?.outputTokens,
    reasoningTokens: run.usage?.reasoningTokens,
    outcome: run.outcome,
  });
  if (!run.result) {
    // Thrown, not swallowed, and the stored summary is left untouched: staff
    // keep whatever was there rather than losing it to a failed attempt.
    throw new Error(run.error ?? "Social summary failed");
  }
  const updatedAt = new Date();
  const written = await db
    .update(projects)
    .set({
      socialSummary: run.result,
      socialSummarySourceHash: socialSummaryHash(source, MODEL_ID),
      socialSummaryIsManual: false,
      socialSummaryUpdatedAt: updatedAt,
    })
    .where(
      and(
        rowStillReads(project, SUMMARY_GUARD_COLUMNS),
        eq(projects.socialSummaryIsManual, project.socialSummaryIsManual)
      )
    )
    .returning({ id: projects.id });
  if (written.length === 0) {
    // Losing the race means writing nothing and saying so. The row is re-read
    // rather than assumed, so the panel shows the wording that is actually
    // stored instead of the text the model produced and nobody kept.
    return { ...toView(await loadProject(project.id)), outcome: "changed" };
  }
  return {
    summary: run.result,
    updatedAt,
    isManual: false,
    outcome: "rewritten",
  };
}

export async function regenerateSocialSummaryForCurrentUser(
  data: SocialSummaryInput
): Promise<RegenerateSocialSummaryResult> {
  const viewer = await requireUser();
  return regenerateSocialSummaryAs(viewer, data);
}

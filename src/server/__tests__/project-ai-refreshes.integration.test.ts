import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "#/db";
import { aiReviewUsage, projectAiRefreshes, projects, user } from "#/db/schema";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import type { AiRefreshKind } from "#/lib/ai-refresh";
import { auth } from "#/lib/auth";
import { recordAiRefresh } from "../_internal/project-ai-refreshes";
import { refreshProjectEmbedding } from "../_internal/project-embeddings";
import { refreshSocialSummary } from "../_internal/project-social-summary";
import {
  getSimilarityAs,
  recomputeSimilarityAs,
} from "../_internal/similarity";
import {
  getSocialSummaryAs,
  regenerateSocialSummaryAs,
} from "../_internal/social-summary";
import { SOCIAL_SUMMARY_TOOL_NAME } from "../_internal/social-summary-core";

/**
 * The record of each project's last AI attempt (#631), written by both
 * automatic writers, by Regenerate and by Recompute, and read by the two
 * staff sections. What it exists for: a project whose output never landed is
 * distinguishable from one nobody tried.
 */

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

function fakeModel(summary: string): ResponsesFn {
  return vi.fn(() =>
    Promise.resolve({
      status: "completed",
      output: [
        {
          type: "function_call",
          name: SOCIAL_SUMMARY_TOOL_NAME,
          arguments: JSON.stringify({ summary }),
        },
      ],
    })
  );
}

const failingModel: ResponsesFn = () =>
  Promise.reject(new Error("Bedrock is down"));

let seq = 0;
const nextEmail = () => `air-${Date.now()}-${seq++}@x.com`;

async function makeUser(role: "user" | "admin") {
  const email = nextEmail();
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeProject(over: Partial<typeof projects.$inferInsert> = {}) {
  const [project] = await db
    .insert(projects)
    .values({
      title: "Rover",
      description: "A rover that streams sensor data.",
      status: "published",
      ...over,
    })
    .returning();
  return project;
}

async function readAttempt(projectId: string, kind: AiRefreshKind) {
  const [row] = await db
    .select()
    .from(projectAiRefreshes)
    .where(
      and(
        eq(projectAiRefreshes.projectId, projectId),
        eq(projectAiRefreshes.kind, kind)
      )
    );
  return row ?? null;
}

// Switched off for the whole integration run so nothing else reaches
// Bedrock; every model here is a fake.
beforeAll(() => {
  process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "true";
});
afterAll(() => {
  process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED = "false";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the automatic writers record their attempts", () => {
  it("records a written summary and a written vector", async () => {
    const project = await makeProject();

    expect(await refreshSocialSummary(project.id, fakeModel("A rover."))).toBe(
      "updated"
    );
    expect(
      await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR))
    ).toBe("updated");

    const summary = await readAttempt(project.id, "social_summary");
    const embedding = await readAttempt(project.id, "embedding");
    expect(summary).toMatchObject({ outcome: "updated", trigger: "automatic" });
    expect(embedding).toMatchObject({
      outcome: "updated",
      trigger: "automatic",
    });
  });

  it("records a failure, which is not the same as no row", async () => {
    const project = await makeProject();

    expect(await refreshSocialSummary(project.id, failingModel)).toBe("failed");
    expect(
      await refreshProjectEmbedding(project.id, () =>
        Promise.reject(new Error("throttled"))
      )
    ).toBe("failed");

    expect(await readAttempt(project.id, "social_summary")).toMatchObject({
      outcome: "failed",
    });
    expect(await readAttempt(project.id, "embedding")).toMatchObject({
      outcome: "failed",
    });
  });

  it("records nothing for a project it skips, so no row means never attempted", async () => {
    const project = await makeProject({ status: "draft" });
    const embed = vi.fn();

    expect(await refreshSocialSummary(project.id, fakeModel("x"))).toBe(
      "skipped"
    );
    expect(await refreshProjectEmbedding(project.id, embed)).toBe("skipped");

    expect(await readAttempt(project.id, "social_summary")).toBeNull();
    expect(await readAttempt(project.id, "embedding")).toBeNull();
  });

  it("leaves the last attempt alone on an unchanged source", async () => {
    // `unchanged` makes no attempt; recording it would stamp a newer time on a
    // failure that is still the latest real attempt.
    const project = await makeProject();
    await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR));
    const first = await readAttempt(project.id, "embedding");

    expect(
      await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR))
    ).toBe("unchanged");
    expect(await readAttempt(project.id, "embedding")).toEqual(first);
  });

  it("records nothing for a summary staff wrote by hand", async () => {
    const project = await makeProject({
      socialSummary: "Staff wording.",
      socialSummaryIsManual: true,
    });

    expect(await refreshSocialSummary(project.id, fakeModel("x"))).toBe(
      "manual"
    );
    expect(await readAttempt(project.id, "social_summary")).toBeNull();
  });

  it("overwrites the last attempt rather than adding rows", async () => {
    const project = await makeProject();
    await refreshProjectEmbedding(project.id, () =>
      Promise.reject(new Error("throttled"))
    );
    await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR));

    const rows = await db
      .select()
      .from(projectAiRefreshes)
      .where(eq(projectAiRefreshes.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("updated");
  });

  it("clears a failure once the stored output matches the text again", async () => {
    // An edit fails, then is reverted: the vector from before the edit is
    // current again, and a failure left beside it would offer a retry with
    // nothing to do.
    const project = await makeProject();
    await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR));
    await db
      .update(projects)
      .set({ description: "An edit whose embedding fails." })
      .where(eq(projects.id, project.id));
    await refreshProjectEmbedding(project.id, () =>
      Promise.reject(new Error("throttled"))
    );
    expect(await readAttempt(project.id, "embedding")).toMatchObject({
      outcome: "failed",
    });

    await db
      .update(projects)
      .set({ description: project.description })
      .where(eq(projects.id, project.id));
    expect(
      await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR))
    ).toBe("unchanged");
    expect(await readAttempt(project.id, "embedding")).toBeNull();
  });

  it("keeps a failure stamped after an unchanged check started", async () => {
    // A staff attempt can fail between the automatic writer reading the row
    // and its cleanup; that failure is newer than the check and must stay.
    const project = await makeProject();
    const failedAt = new Date();
    await db.insert(projectAiRefreshes).values({
      projectId: project.id,
      kind: "embedding",
      trigger: "staff",
      outcome: "failed",
      attemptedAt: failedAt,
    });

    await recordAiRefresh(
      project.id,
      "embedding",
      "automatic",
      "unchanged",
      new Date(failedAt.getTime() - 1000)
    );
    expect(await readAttempt(project.id, "embedding")).toMatchObject({
      outcome: "failed",
    });

    await recordAiRefresh(
      project.id,
      "embedding",
      "automatic",
      "unchanged",
      new Date(failedAt.getTime() + 1000)
    );
    expect(await readAttempt(project.id, "embedding")).toBeNull();
  });

  it("keeps the later attempt when an earlier one commits after it", async () => {
    // Recompute and Regenerate do not share the background queue.
    const project = await makeProject();
    const later = new Date();
    await db.insert(projectAiRefreshes).values({
      projectId: project.id,
      kind: "embedding",
      trigger: "staff",
      outcome: "updated",
      attemptedAt: new Date(later.getTime() + 60_000),
    });

    await refreshProjectEmbedding(project.id, () =>
      Promise.reject(new Error("throttled"))
    );
    expect(await readAttempt(project.id, "embedding")).toMatchObject({
      outcome: "updated",
      trigger: "staff",
    });
  });

  it("records a write the text moved under as superseded", async () => {
    // A save on another task changes the text during the model call, so the
    // guarded write matches nothing (ADR-0053).
    const project = await makeProject();
    const editsMidCall: ResponsesFn = async (body) => {
      await db
        .update(projects)
        .set({ description: "Text saved during the call." })
        .where(eq(projects.id, project.id));
      return fakeModel("Of the text the model was shown.")(body);
    };

    expect(await refreshSocialSummary(project.id, editsMidCall)).toBe(
      "superseded"
    );
    expect(await readAttempt(project.id, "social_summary")).toMatchObject({
      outcome: "superseded",
      trigger: "automatic",
    });
  });

  it("keeps the writer's outcome when the record cannot be written", async () => {
    // The save has committed; losing the record costs a status line, never
    // the outcome the refresh log line and its alarm read.
    const project = await makeProject();
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      // Asserted below.
    });
    const cause = new Error("connection reset");
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw cause;
    });

    expect(await refreshSocialSummary(project.id, fakeModel("A rover."))).toBe(
      "updated"
    );
    // The redacted string, not the error object, whose query parameters
    // would carry the bound values into the log.
    expect(error).toHaveBeenCalledWith(
      `Recording the social_summary attempt failed for project ${project.id}`,
      redactQueryError(cause)
    );
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(row.socialSummary).toBe("A rover.");
  });
});

describe("Regenerate records a staff attempt", () => {
  it("records a rewrite", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject();

    await regenerateSocialSummaryAs(
      admin,
      { projectId: project.id },
      fakeModel("Rewritten.")
    );

    expect(await readAttempt(project.id, "social_summary")).toMatchObject({
      outcome: "updated",
      trigger: "staff",
    });
    // Beside its usage row, not instead of it: the two answer different
    // questions (ADR-0060).
    const usage = await db
      .select()
      .from(aiReviewUsage)
      .where(eq(aiReviewUsage.projectId, project.id));
    expect(usage).toHaveLength(1);
  });

  it("records a lost race as superseded", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject();
    const editsMidCall: ResponsesFn = async (body) => {
      await db
        .update(projects)
        .set({ description: "What the proposer saved mid-call." })
        .where(eq(projects.id, project.id));
      return fakeModel("A summary of the older text.")(body);
    };

    const result = await regenerateSocialSummaryAs(
      admin,
      { projectId: project.id },
      editsMidCall
    );
    expect(result.outcome).toBe("changed");
    expect(await readAttempt(project.id, "social_summary")).toMatchObject({
      outcome: "superseded",
      trigger: "staff",
    });
  });

  it("records a failed run before throwing it", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject();

    await expect(
      regenerateSocialSummaryAs(admin, { projectId: project.id }, failingModel)
    ).rejects.toThrow();

    expect(await readAttempt(project.id, "social_summary")).toMatchObject({
      outcome: "failed",
      trigger: "staff",
    });
    const view = await getSocialSummaryAs(admin, { projectId: project.id });
    expect(view.summaryAttempt).toMatchObject({ outcome: "failed" });
  });

  it("records nothing for a refusal before the model call", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject({ title: "", description: null });

    await expect(
      regenerateSocialSummaryAs(
        admin,
        { projectId: project.id },
        fakeModel("x")
      )
    ).rejects.toThrow(/no title, description/);

    expect(await readAttempt(project.id, "social_summary")).toBeNull();
  });
});

describe("the summary view", () => {
  it("drops a failure older than the summary stored since", async () => {
    // A staff Save and the production sweep write without recording, so an
    // older failure must not sit beside the newer text as if it were current.
    const admin = await makeUser("admin");
    const project = await makeProject();
    await refreshSocialSummary(project.id, failingModel);
    await db
      .update(projects)
      .set({ socialSummary: "Swept.", socialSummaryUpdatedAt: new Date() })
      .where(eq(projects.id, project.id));

    const view = await getSocialSummaryAs(admin, { projectId: project.id });
    expect(view.summaryAttempt).toBeNull();
    expect(view.refreshable).toBe(true);
  });

  it("says a draft is not refreshable", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject({ status: "draft" });

    const view = await getSocialSummaryAs(admin, { projectId: project.id });
    expect(view.refreshable).toBe(false);
    expect(view.summaryAttempt).toBeNull();
  });
});

describe("similarity", () => {
  it("refuses a student, on the read and on Recompute, without calling Bedrock", async () => {
    const student = await makeUser("user");
    const project = await makeProject();
    const embed = vi.fn();

    await expect(
      getSimilarityAs(student, { projectId: project.id })
    ).rejects.toThrow();
    await expect(
      recomputeSimilarityAs(student, { projectId: project.id }, embed)
    ).rejects.toThrow();
    expect(embed).not.toHaveBeenCalled();
    expect(await readAttempt(project.id, "embedding")).toBeNull();
  });

  it("shows never computed, then a failure, then the recompute that fixed it", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject();

    expect(await getSimilarityAs(admin, { projectId: project.id })).toEqual({
      attempt: null,
      computed: false,
      computedAt: null,
      refreshable: true,
    });

    await refreshProjectEmbedding(project.id, () =>
      Promise.reject(new Error("throttled"))
    );
    const failed = await getSimilarityAs(admin, { projectId: project.id });
    expect(failed.attempt).toMatchObject({
      outcome: "failed",
      trigger: "automatic",
    });
    expect(failed.computedAt).toBeNull();

    const result = await recomputeSimilarityAs(
      admin,
      { projectId: project.id },
      () => Promise.resolve(VECTOR)
    );
    expect(result.outcome).toBe("updated");
    expect(result.attempt).toMatchObject({
      outcome: "updated",
      trigger: "staff",
    });
    expect(result.computedAt).toBeInstanceOf(Date);
  });

  it("returns the writer's skip for a project that left an embeddable status", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject({ status: "draft" });
    const embed = vi.fn();

    const result = await recomputeSimilarityAs(
      admin,
      { projectId: project.id },
      embed
    );
    expect(result.outcome).toBe("skipped");
    expect(result.refreshable).toBe(false);
    expect(embed).not.toHaveBeenCalled();
  });

  it("never returns the vector", async () => {
    const admin = await makeUser("admin");
    const project = await makeProject();
    await refreshProjectEmbedding(project.id, () => Promise.resolve(VECTOR));

    const view = await getSimilarityAs(admin, { projectId: project.id });
    expect(Object.keys(view).sort()).toEqual([
      "attempt",
      "computed",
      "computedAt",
      "refreshable",
    ]);
  });
});

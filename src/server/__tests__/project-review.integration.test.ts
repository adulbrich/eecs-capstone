import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { aiReviewUsage, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";

// Mock the core so no real Bedrock call happens. The fake doubles as the
// assertion that the limiter runs first: if it was not called, nothing was
// spent.
const runProjectReview = vi.fn();
vi.mock("../_internal/project-review-core", () => ({
  runProjectReview: (...args: unknown[]) => runProjectReview(...args),
}));

import { reviewProjectAs } from "../_internal/project-review";

function okRun(model = "test-model") {
  return {
    called: true,
    model,
    outcome: "ok" as const,
    reasoningEffort: "medium",
    result: {
      suggestions: {
        description: { suggestion: "Better.", rationale: "clearer" },
      },
      model,
      reviewedFields: ["description"],
    },
    usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5 },
  };
}

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  if (role !== "user") {
    await db.update(user).set({ role }).where(eq(user.email, email));
  }
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function usageRowsFor(userId: string) {
  return db
    .select()
    .from(aiReviewUsage)
    .where(eq(aiReviewUsage.userId, userId));
}

afterEach(() => {
  runProjectReview.mockReset();
  process.env.AI_REVIEW_LIMIT_PER_HOUR = undefined;
  delete process.env.AI_REVIEW_LIMIT_PER_HOUR;
  delete process.env.AI_REVIEW_LIMIT_PER_DAY;
});

describe("reviewProjectAs authorization", () => {
  it("returns suggestions for a user who can edit the project", async () => {
    runProjectReview.mockResolvedValue(okRun());
    const owner = await makeUser(`owner-${Date.now()}@x.com`, "user");
    const [project] = await db
      .insert(projects)
      .values({ title: "P", proposerId: owner.id, status: "draft" })
      .returning();

    const result = await reviewProjectAs(owner, {
      projectId: project.id,
      fields: { description: "old" },
    });
    expect(result.reviewedFields).toEqual(["description"]);
  });

  it("reviews unsaved text with no project, for any verified user", async () => {
    runProjectReview.mockResolvedValue(okRun());
    const anyone = await makeUser(`anyone-${Date.now()}@x.com`, "user");

    // The submission page path: nothing is saved, so there is no owner to
    // check and the session is the whole gate.
    const result = await reviewProjectAs(anyone, {
      fields: { description: "old" },
    });
    expect(result.reviewedFields).toEqual(["description"]);
  });

  it("still refuses a project the viewer cannot edit", async () => {
    runProjectReview.mockResolvedValue(okRun());
    const owner = await makeUser(`owner2-${Date.now()}@x.com`, "user");
    const stranger = await makeUser(`stranger-${Date.now()}@x.com`, "user");
    const [project] = await db
      .insert(projects)
      .values({ title: "P", proposerId: owner.id, status: "draft" })
      .returning();

    await expect(
      reviewProjectAs(stranger, {
        projectId: project.id,
        fields: { description: "old" },
      })
    ).rejects.toThrow("Forbidden");
    // Refused before spending, not after.
    expect(runProjectReview).not.toHaveBeenCalled();
  });

  it("throws when the project does not exist", async () => {
    const someone = await makeUser(`someone-${Date.now()}@x.com`, "user");
    await expect(
      reviewProjectAs(someone, {
        projectId: "00000000-0000-0000-0000-000000000000",
        fields: { description: "old" },
      })
    ).rejects.toThrow("Project not found");
    expect(runProjectReview).not.toHaveBeenCalled();
  });
});

describe("reviewProjectAs metering", () => {
  it("records a usage row per call, with the token counts", async () => {
    runProjectReview.mockResolvedValue(okRun());
    const u = await makeUser(`meter-${Date.now()}@x.com`, "user");

    await reviewProjectAs(u, { fields: { description: "old" } });

    const rows = await usageRowsFor(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("ok");
    expect(rows[0].reasoningTokens).toBe(5);
    expect(rows[0].projectId).toBeNull();
    expect(rows[0].reviewedFieldCount).toBe(1);
  });

  it("records nothing when no call was made", async () => {
    runProjectReview.mockResolvedValue({
      called: false,
      model: "m",
      outcome: "ok" as const,
      reasoningEffort: "medium",
      result: { suggestions: {}, model: "m", reviewedFields: [] },
    });
    const u = await makeUser(`nocall-${Date.now()}@x.com`, "user");

    await reviewProjectAs(u, { fields: { description: "   " } });

    expect(await usageRowsFor(u.id)).toHaveLength(0);
  });

  it("counts a failed review, because it was billed all the same", async () => {
    runProjectReview.mockResolvedValue({
      called: true,
      model: "m",
      outcome: "truncated" as const,
      reasoningEffort: "medium",
      error: "The review ran out of room before it finished.",
      result: { suggestions: {}, model: "m", reviewedFields: [] },
      usage: {
        inputTokens: 900,
        outputTokens: 16_384,
        reasoningTokens: 16_000,
      },
    });
    const u = await makeUser(`failed-${Date.now()}@x.com`, "user");

    await expect(
      reviewProjectAs(u, { fields: { description: "old" } })
    ).rejects.toThrow(/ran out of room/);

    const rows = await usageRowsFor(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("truncated");
  });

  it("blocks the call past the hourly limit, before spending", async () => {
    process.env.AI_REVIEW_LIMIT_PER_HOUR = "2";
    runProjectReview.mockResolvedValue(okRun());
    const u = await makeUser(`limited-${Date.now()}@x.com`, "user");

    await reviewProjectAs(u, { fields: { description: "one" } });
    await reviewProjectAs(u, { fields: { description: "two" } });
    expect(runProjectReview).toHaveBeenCalledTimes(2);

    await expect(
      reviewProjectAs(u, { fields: { description: "three" } })
    ).rejects.toThrow(/for this hour/);

    // The assertion that matters: the limiter saves money rather than merely
    // reporting an error after the fact.
    expect(runProjectReview).toHaveBeenCalledTimes(2);
    expect(await usageRowsFor(u.id)).toHaveLength(2);
  });

  it("counts one user's reviews against that user only", async () => {
    process.env.AI_REVIEW_LIMIT_PER_HOUR = "1";
    runProjectReview.mockResolvedValue(okRun());
    const a = await makeUser(`solo-a-${Date.now()}@x.com`, "user");
    const b = await makeUser(`solo-b-${Date.now()}@x.com`, "user");

    await reviewProjectAs(a, { fields: { description: "one" } });
    await expect(
      reviewProjectAs(a, { fields: { description: "two" } })
    ).rejects.toThrow(/for this hour/);

    await expect(
      reviewProjectAs(b, { fields: { description: "one" } })
    ).resolves.toBeDefined();
  });
});

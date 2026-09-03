import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "#/db";
import { aiReviewUsage, programs, projects, user } from "#/db/schema";
import type { MantleResponse } from "#/lib/_internal/bedrock-mantle";
import { auth } from "#/lib/auth";
import {
  assertWithinLimit,
  recordReviewUsage,
} from "#/server/_internal/ai-review-usage";
import { createProgramAs } from "#/server/_internal/programs";
import {
  createProjectAs,
  forceTransitionAs,
} from "#/server/_internal/projects";
import { getProjectAs } from "#/server/_internal/projects-queries";
import {
  assessProjectScopeAs,
  getScopeAssessmentAs,
} from "#/server/_internal/scope-assessment";
import { SCOPE_TOOL_NAME } from "#/server/_internal/scope-assessment-core";

async function makeUser(email: string, role: "user" | "admin" | "instructor") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

const verdict = {
  oneTerm: "too_large",
  threeTerms: "about_right",
  confidence: 0.6,
  rationale: "Two services and a mobile client exceed one term.",
};

const invoke = async (): Promise<MantleResponse> => ({
  status: "completed",
  output: [
    {
      type: "function_call",
      name: SCOPE_TOOL_NAME,
      arguments: JSON.stringify(verdict),
    },
  ],
  usage: { input_tokens: 5, output_tokens: 9 },
});

function baseProject() {
  return {
    title: "Trail camera classifier",
    description: "Classify species from trail camera images.",
    problemStatement: "Researchers label by hand.",
    objectives: "- Train a model\n- Build a review tool",
    minQualifications: "Python",
    prefQualifications: null,
    contactName: "P",
    contactEmail: "p@x.test",
    url: null,
    licenseRestrictions: null,
    requiresNdaIp: false,
    isSponsored: false,
    teamsSupported: 1,
    acceptingApplicants: true,
    programId: null,
    imageUrl: null,
    notes: null,
    categoryIds: [],
  };
}

afterEach(() => {
  delete process.env.AI_REVIEW_LIMIT_PER_HOUR;
  delete process.env.AI_SCOPE_LIMIT_PER_HOUR;
});

describe("the scope assessment is staff only, at the seam", () => {
  it("refuses the proposer, and spends nothing", async () => {
    const owner = await makeUser(`sc-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await expect(
      assessProjectScopeAs(owner, { projectId: id }, invoke)
    ).rejects.toThrow(/Forbidden/);
    await expect(
      getScopeAssessmentAs(owner, { projectId: id })
    ).rejects.toThrow(/Forbidden/);
    const rows = await db
      .select()
      .from(aiReviewUsage)
      .where(eq(aiReviewUsage.userId, owner.id));
    expect(rows).toHaveLength(0);
  });

  it("never enters the anonymous or proposer payload", async () => {
    const owner = await makeUser(`sc-p-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`sc-pa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await assessProjectScopeAs(admin, { projectId: id }, invoke);
    // Published, so the anonymous read returns the project at all.
    await forceTransitionAs(admin, id, "published", undefined, {
      sendEmail: false,
    });
    for (const viewer of [null, owner, admin]) {
      const { project } = await getProjectAs(viewer, { id });
      for (const key of [
        "scopeAssessment",
        "scopeAssessmentSourceHash",
        "scopeAssessmentUpdatedAt",
      ]) {
        expect(project).not.toHaveProperty(key);
      }
    }
  });
});

describe("the stored assessment and its staleness", () => {
  it("stores the verdict, reads it back fresh, and reports stale once the text moves", async () => {
    const admin = await makeUser(`sc-a-${Date.now()}@x.com`, "admin");
    const program = await createProgramAs(admin, {
      courseId: `SC-${Date.now()}`,
      courseName: "Capstone",
      description: null,
      termCount: 3,
    });
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      programId: program.id,
    });
    expect(await getScopeAssessmentAs(admin, { projectId: id })).toBeNull();

    const fresh = await assessProjectScopeAs(admin, { projectId: id }, invoke);
    expect(fresh.stale).toBe(false);
    expect(fresh.assessment).toMatchObject(verdict);

    const read = await getScopeAssessmentAs(admin, { projectId: id });
    expect(read?.stale).toBe(false);
    expect(read?.assessment.oneTerm).toBe("too_large");

    // The text changed under the verdict: still returned, marked stale, not
    // re-run (no second usage row).
    await db
      .update(projects)
      .set({ objectives: "- Train a model" })
      .where(eq(projects.id, id));
    const after = await getScopeAssessmentAs(admin, { projectId: id });
    expect(after?.stale).toBe(true);
    expect(after?.assessment.oneTerm).toBe("too_large");
    const rows = await db
      .select()
      .from(aiReviewUsage)
      .where(eq(aiReviewUsage.userId, admin.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feature).toBe("scope");
    expect(rows[0]?.outcome).toBe("ok");
  });

  it("goes stale when the program's term count changes", async () => {
    const admin = await makeUser(`sc-t-${Date.now()}@x.com`, "admin");
    const program = await createProgramAs(admin, {
      courseId: `SCT-${Date.now()}`,
      courseName: "Capstone",
      description: null,
      termCount: 1,
    });
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      programId: program.id,
    });
    await assessProjectScopeAs(admin, { projectId: id }, invoke);
    // The term count is part of what was judged against, so moving it is a
    // reason the verdict may no longer hold.
    await db
      .update(programs)
      .set({ termCount: 3 })
      .where(eq(programs.id, program.id));
    const after = await getScopeAssessmentAs(admin, { projectId: id });
    expect(after?.stale).toBe(true);
  });
});

describe("the scope limit is its own", () => {
  it("is not spent by reviews, and does not spend the review's", async () => {
    process.env.AI_REVIEW_LIMIT_PER_HOUR = "1";
    process.env.AI_SCOPE_LIMIT_PER_HOUR = "1";
    const admin = await makeUser(`sc-l-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    // Exhaust the review's hour with a recorded review call.
    await recordReviewUsage({
      feature: "review",
      userId: admin.id,
      model: "m",
      reasoningEffort: "medium",
      reviewedFieldCount: 1,
      outcome: "ok",
    });
    await expect(assertWithinLimit(admin.id, "review")).rejects.toThrow(
      /AI reviews/
    );
    // The scope assessment still runs.
    await assessProjectScopeAs(admin, { projectId: id }, invoke);

    // Now the scope hour is spent, named as such, and the review is untouched.
    await expect(
      assessProjectScopeAs(admin, { projectId: id }, invoke)
    ).rejects.toThrow(/scope assessments/);
    const rows = await db
      .select()
      .from(aiReviewUsage)
      .where(eq(aiReviewUsage.userId, admin.id));
    expect(rows.map((r) => r.feature).sort()).toEqual(["review", "scope"]);
  });
});

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";

// Mock the core so no real Bedrock call happens; we only test auth gating.
vi.mock("../_internal/project-review-core", () => ({
  runProjectReview: vi.fn().mockResolvedValue({
    suggestions: {
      description: { suggestion: "Better.", rationale: "clearer" },
    },
    model: "test-model",
    reviewedFields: ["description"],
  }),
}));

import { reviewProjectAs } from "../_internal/project-review";

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

describe("reviewProjectAs", () => {
  it("returns suggestions for a user who can edit the project", async () => {
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

  it("throws Forbidden for a user who cannot edit the project", async () => {
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
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("throws when the project does not exist", async () => {
    const someone = await makeUser(`someone-${Date.now()}@x.com`, "user");
    await expect(
      reviewProjectAs(someone, {
        projectId: "00000000-0000-0000-0000-000000000000",
        fields: { description: "old" },
      }),
    ).rejects.toThrow("Project not found");
  });
});

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  notifications,
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
  updateProjectAs,
} from "#/server/projects";

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

function baseProject() {
  return {
    title: "P",
    description: null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId: null,
    notes: null,
  };
}

describe("project workflow", () => {
  it("create -> submit -> request changes -> resubmit -> approve -> publish writes the expected history + notifications", async () => {
    const owner = await makeUser(`o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");

    const { id } = await createProjectAs(owner, baseProject());

    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "changes_requested", "fix X");
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history).toHaveLength(5);

    const [final] = await db.select().from(projects).where(eq(projects.id, id));
    expect(final.status).toBe("published");
    expect(final.publishedAt).not.toBeNull();

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.length).toBeGreaterThan(0);
  });

  it("owner cannot publish", async () => {
    const owner = await makeUser(`o2-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, id, "submitted");
    await expect(performTransitionAs(owner, id, "published")).rejects.toThrow();
  });

  it("updateProject writes one edit-log row capturing only changed fields", async () => {
    const owner = await makeUser(`o3-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      description: "old",
    });
    await updateProjectAs(owner, {
      id,
      ...baseProject(),
      description: "new",
    });
    const rows = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].changedFields).toEqual(["description"]);
  });

  it("soft delete sets deletedAt; restore clears it", async () => {
    const owner = await makeUser(`o4-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a4-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    await softDeleteProjectAs(admin, id);
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.deletedAt).not.toBeNull();
  });
});

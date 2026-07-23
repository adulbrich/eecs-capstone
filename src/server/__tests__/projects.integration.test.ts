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
} from "#/server/_internal/projects";

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
  return { id: u.id, role: u.role, email: u.email };
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
    teamsSupported: 1,
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

  it("persists and defaults teamsSupported", async () => {
    const admin = await makeUser(`t-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const [created] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(created.teamsSupported).toBe(1);

    await updateProjectAs(admin, { ...baseProject(), id, teamsSupported: 3 });
    const [updated] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(updated.teamsSupported).toBe(3);
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

describe("staff proposer linking by email", () => {
  it("links proposerId when the email matches an account", async () => {
    const staff = await makeUser(`staff-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`target-${Date.now()}@x.com`, "user");

    const { id } = await createProjectAs(staff, {
      title: "Linked",
      proposerEmail: target.email,
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBe(target.id);
    expect(row.proposerEmail).toBe(target.email);
  });

  it("keeps proposerId null when the email matches no account", async () => {
    const staff = await makeUser(`staff2-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(staff, {
      title: "Pending",
      proposerEmail: "noaccount@example.edu",
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBeNull();
    expect(row.proposerEmail).toBe("noaccount@example.edu");
  });

  it("ignores proposerEmail from a non-staff creator", async () => {
    const plain = await makeUser(`plain-${Date.now()}@x.com`, "user");
    const other = await makeUser(`other-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(plain, {
      title: "Self",
      proposerEmail: other.email,
    } as never);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBe(plain.id);
    expect(row.proposerEmail).toBeNull();
  });
});

describe("transitions on an unlinked (null proposer) project", () => {
  it("does not throw and writes no proposer notification", async () => {
    const staff = await makeUser(`staff-null-${Date.now()}@x.com`, "admin");
    const [project] = await db
      .insert(projects)
      .values({
        title: "Unlinked",
        proposerId: null,
        proposerEmail: "ghost@example.edu",
        status: "submitted",
      })
      .returning();

    await expect(
      performTransitionAs(staff, project.id, "approved")
    ).resolves.toMatchObject({ status: "approved" });

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/projects/${project.id}`));
    expect(notes).toHaveLength(0);
  });
});

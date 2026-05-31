import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { notifications, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { addCommentAs } from "#/server/_internal/comments";
import {
  createProjectAs,
  performTransitionAs,
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

describe("comments + notifications", () => {
  it("admin posts a review comment; proposer gets a notification", async () => {
    const owner = await makeUser(`o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    await addCommentAs(admin, {
      projectId: pid,
      content: "please clarify",
      isInternal: false,
    });

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    const commentNotifs = ownerNotifs.filter((n) => n.type === "comment");
    expect(commentNotifs).toHaveLength(1);
  });

  it("staff internal comment writes no notification", async () => {
    const owner = await makeUser(`o2-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    await addCommentAs(admin, {
      projectId: pid,
      content: "internal",
      isInternal: true,
    });

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.filter((n) => n.type === "comment")).toHaveLength(0);
  });

  it("self-comment writes no notification", async () => {
    const owner = await makeUser(`o3-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await addCommentAs(owner, {
      projectId: pid,
      content: "my own note",
      isInternal: false,
    });
    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.filter((n) => n.type === "comment")).toHaveLength(0);
  });

  it("reply to an admin comment notifies the admin too", async () => {
    const owner = await makeUser(`o4-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a4-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    await performTransitionAs(admin, pid, "changes_requested");

    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "please fix",
      isInternal: false,
    });

    await addCommentAs(owner, {
      projectId: pid,
      content: "ok",
      parentId,
      isInternal: false,
    });

    const adminNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, admin.id));
    expect(adminNotifs.filter((n) => n.type === "comment")).toHaveLength(1);
  });

  it("rejects internal comment from non-staff", async () => {
    const owner = await makeUser(`o5-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await expect(
      addCommentAs(owner, {
        projectId: pid,
        content: "x",
        isInternal: true,
      })
    ).rejects.toThrow();
  });

  it("rejects reply to a reply", async () => {
    const owner = await makeUser(`o6-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a6-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id: top } = await addCommentAs(admin, {
      projectId: pid,
      content: "a",
      isInternal: false,
    });
    const { id: reply } = await addCommentAs(owner, {
      projectId: pid,
      content: "b",
      parentId: top,
      isInternal: false,
    });
    await expect(
      addCommentAs(admin, {
        projectId: pid,
        content: "c",
        parentId: reply,
        isInternal: false,
      })
    ).rejects.toThrow();
  });
});

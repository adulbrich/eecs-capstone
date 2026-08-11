import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projectBookmarks, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  addBookmarkAs,
  isBookmarkedAs,
  listMyBookmarksAs,
  removeBookmarkAs,
} from "#/server/_internal/bookmarks";
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
    .set({ emailVerified: true, ...(role === "admin" ? { role } : {}) })
    .where(eq(user.email, email));
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

/** A project anyone may see: created by staff and taken to published. */
async function publishedProject(admin: { id: string; role: string | null }) {
  const { id } = await createProjectAs(admin, baseProject());
  await performTransitionAs(admin, id, "submitted");
  await performTransitionAs(admin, id, "approved");
  await performTransitionAs(admin, id, "published");
  return id;
}

async function bookmarkRows(userId: string) {
  return await db
    .select()
    .from(projectBookmarks)
    .where(eq(projectBookmarks.userId, userId));
}

describe("bookmarks", () => {
  it("refuses a project the viewer may not see", async () => {
    // The check with no coverage before this file was rewritten. A draft is
    // visible to its staff creator and to nobody else, so a student holding
    // the id must not be able to bookmark it.
    const admin = await makeUser(`ba-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`bs-${Date.now()}@x.com`, "user");
    const { id: draftId } = await createProjectAs(admin, baseProject());

    await expect(
      addBookmarkAs(student, { projectId: draftId })
    ).rejects.toThrow(/Forbidden/);
    expect(await bookmarkRows(student.id)).toHaveLength(0);
  });

  it("refuses a project that does not exist", async () => {
    const student = await makeUser(`bn-${Date.now()}@x.com`, "user");
    await expect(
      addBookmarkAs(student, {
        projectId: "11111111-1111-4111-8111-111111111111",
      })
    ).rejects.toThrow(/not found/i);
  });

  it("adds once, and adding again is idempotent", async () => {
    const admin = await makeUser(`bi-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`bj-${Date.now()}@x.com`, "user");
    const projectId = await publishedProject(admin);

    await addBookmarkAs(student, { projectId });
    await addBookmarkAs(student, { projectId });

    expect(await bookmarkRows(student.id)).toHaveLength(1);
  });

  it("reports whether a project is bookmarked", async () => {
    const admin = await makeUser(`bk-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`bl-${Date.now()}@x.com`, "user");
    const projectId = await publishedProject(admin);

    expect(await isBookmarkedAs(student, { projectId })).toEqual({
      bookmarked: false,
    });
    await addBookmarkAs(student, { projectId });
    expect(await isBookmarkedAs(student, { projectId })).toEqual({
      bookmarked: true,
    });
  });

  it("removes only the viewer's own bookmark", async () => {
    // Both students bookmark the same project. One removing it must not
    // remove the other's, which is what scoping the delete by user id buys.
    const admin = await makeUser(`bm-${Date.now()}@x.com`, "admin");
    const one = await makeUser(`bo-${Date.now()}@x.com`, "user");
    const two = await makeUser(`bp-${Date.now()}@x.com`, "user");
    const projectId = await publishedProject(admin);

    await addBookmarkAs(one, { projectId });
    await addBookmarkAs(two, { projectId });
    await removeBookmarkAs(one, { projectId });

    expect(await bookmarkRows(one.id)).toHaveLength(0);
    expect(await bookmarkRows(two.id)).toHaveLength(1);
  });

  it("drops a soft-deleted project out of the listing", async () => {
    const admin = await makeUser(`bq-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`br-${Date.now()}@x.com`, "user");
    const kept = await publishedProject(admin);
    const deleted = await publishedProject(admin);
    await addBookmarkAs(student, { projectId: kept });
    await addBookmarkAs(student, { projectId: deleted });

    await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, deleted));

    const { rows } = await listMyBookmarksAs(student);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(kept);
    expect(ids).not.toContain(deleted);
    // The bookmark row itself survives; only the listing hides it.
    expect(
      await db
        .select()
        .from(projectBookmarks)
        .where(
          and(
            eq(projectBookmarks.userId, student.id),
            eq(projectBookmarks.projectId, deleted)
          )
        )
    ).toHaveLength(1);
  });

  it("lists newest first, and only the viewer's own", async () => {
    const admin = await makeUser(`bt-${Date.now()}@x.com`, "admin");
    const mine = await makeUser(`bu-${Date.now()}@x.com`, "user");
    const other = await makeUser(`bv-${Date.now()}@x.com`, "user");
    const first = await publishedProject(admin);
    const second = await publishedProject(admin);
    const theirs = await publishedProject(admin);

    await addBookmarkAs(mine, { projectId: first });
    await addBookmarkAs(mine, { projectId: second });
    await addBookmarkAs(other, { projectId: theirs });

    const { rows } = await listMyBookmarksAs(mine);
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });
});

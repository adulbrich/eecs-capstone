import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { notifications, projectComments, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { addCommentAs } from "#/server/_internal/comments";
import {
  createProjectAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import { listProjectCommentsAs } from "#/server/_internal/projects-queries";

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
    await performTransitionAs(
      admin,
      pid,
      "changes_requested",
      "Please revise."
    );

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

  it("forces a reply to an internal comment to be internal", async () => {
    const owner = await makeUser(`o7-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a7-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "internal parent",
      isInternal: true,
    });
    const { id: replyId } = await addCommentAs(admin, {
      projectId: pid,
      content: "reply that asked to be public",
      parentId,
      isInternal: false,
    });

    const [reply] = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.id, replyId));
    expect(reply.isInternal).toBe(true);
  });

  it("does not notify the proposer about an inherited-internal reply", async () => {
    const owner = await makeUser(`o8-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a8-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "internal parent",
      isInternal: true,
    });
    await addCommentAs(admin, {
      projectId: pid,
      content: "internal reply",
      parentId,
      isInternal: false,
    });

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs.filter((n) => n.type === "comment")).toHaveLength(0);
  });

  it("keeps an internal reply to a public comment out of the proposer's view", async () => {
    const owner = await makeUser(`o9-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a9-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");

    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "public parent",
      isInternal: false,
    });
    await addCommentAs(admin, {
      projectId: pid,
      content: "staff aside",
      parentId,
      isInternal: true,
    });

    const { rows: ownerRows } = await listProjectCommentsAs(owner, { id: pid });
    expect(ownerRows.map((r) => r.content)).toEqual(["public parent"]);

    const { rows: staffRows } = await listProjectCommentsAs(admin, { id: pid });
    expect(staffRows).toHaveLength(2);
  });

  it("still refuses an internal comment from a non-staff replier", async () => {
    const owner = await makeUser(`o10-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a10-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id: parentId } = await addCommentAs(admin, {
      projectId: pid,
      content: "public parent",
      isInternal: false,
    });

    await expect(
      addCommentAs(owner, {
        projectId: pid,
        content: "sneaky",
        parentId,
        isInternal: true,
      })
    ).rejects.toThrow();
  });

  it("returns the author's name so the thread need not show ids", async () => {
    const owner = await makeUser(`o11-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a11-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    await addCommentAs(admin, {
      projectId: pid,
      content: "named",
      isInternal: false,
    });

    const { rows } = await listProjectCommentsAs(admin, { id: pid });
    const [adminRow] = await db
      .select()
      .from(user)
      .where(eq(user.id, admin.id));
    expect(rows[0].authorName).toBe(adminRow.name);
    expect(rows[0].authorName).toBeTruthy();
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

describe("addCommentAs cross-user guard", () => {
  it("refuses a viewer who is neither proposer nor staff, and writes nothing", async () => {
    // #155. The guard is read-adjacent as well as a write gate: comments are
    // what `comments.ts` calls a private submitter to staff dialogue, so a
    // stranger who could post would be joining a thread they may not read.
    const owner = await makeUser(`c-o-${Date.now()}@x.com`, "user");
    const stranger = await makeUser(`c-s-${Date.now()}@x.com`, "user");
    const { id: projectId } = await createProjectAs(owner, baseProject());

    await expect(
      addCommentAs(stranger, {
        projectId,
        content: "let me in",
        isInternal: false,
      })
    ).rejects.toThrow(/Forbidden/);

    const rows = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.projectId, projectId));
    expect(rows).toHaveLength(0);
  });
});

describe("comment emails", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("emails the proposer on a staff comment, the staff inbox on a proposer reply, nobody on an internal one", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_STAFF_INBOX = "staff@oregonstate.edu";
    const ownerEmail = `o-mail-${Date.now()}@x.com`;
    const owner = await makeUser(ownerEmail, "user");
    const admin = await makeUser(`a-mail-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const send = vi.fn().mockResolvedValue(undefined);

    const { id: parentId } = await addCommentAs(
      admin,
      { projectId: pid, content: "Add a timeline.", isInternal: false },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(ownerEmail);
    expect(send.mock.calls[0]?.[1].text).toContain(`#comment-${parentId}`);

    send.mockClear();
    await addCommentAs(
      owner,
      { projectId: pid, content: "Done.", parentId, isInternal: false },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("staff@oregonstate.edu");
    expect(send.mock.calls[0]?.[1].subject).toBe(
      "Comment from the proposer: P"
    );

    send.mockClear();
    await addCommentAs(
      admin,
      { projectId: pid, content: "Looks thin.", isInternal: true },
      { send }
    );
    expect(send).not.toHaveBeenCalled();
  });
});

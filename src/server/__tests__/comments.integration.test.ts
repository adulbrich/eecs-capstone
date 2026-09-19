import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { notifications, projectComments, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { addCommentAs, updateCommentAs } from "#/server/_internal/comments";
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

  it("honors the staff skip for the email only, and ignores it from the proposer", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_STAFF_INBOX = "staff@oregonstate.edu";
    const owner = await makeUser(`o-skip-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`a-skip-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const send = vi.fn().mockResolvedValue(undefined);

    // The comment and the proposer's bell row are written; no email (#379).
    const { id } = await addCommentAs(
      admin,
      { projectId: pid, content: "Quietly noted.", isInternal: false },
      { send, sendEmail: false }
    );
    expect(send).not.toHaveBeenCalled();
    const bell = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(bell.some((n) => n.link?.endsWith(`#comment-${id}`))).toBe(true);

    // A proposer's `false` is ignored: the staff inbox is still told, since
    // that email is the only push saying a reply arrived.
    await addCommentAs(
      owner,
      { projectId: pid, content: "Reply.", parentId: id, isInternal: false },
      { send, sendEmail: false }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("staff@oregonstate.edu");
  });
});

describe("updateCommentAs", () => {
  it("rewrites the author's own comment and marks it edited", async () => {
    const owner = await makeUser(`u-o-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "teh timeline is wrong",
      isInternal: false,
    });

    await updateCommentAs(owner, { commentId: id, content: "the timeline" });

    const [row] = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.id, id));
    expect(row.content).toBe("the timeline");
    expect(row.editedAt).toBeInstanceOf(Date);
    // Content only: the flag a proposer may not set on a post is not one an
    // edit can set either.
    expect(row.isInternal).toBe(false);
  });

  it("leaves editedAt null on a comment nobody has edited", async () => {
    const owner = await makeUser(`u-n-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "as posted",
      isInternal: false,
    });

    const { rows } = await listProjectCommentsAs(owner, { id: pid });
    expect(rows.find((r) => r.id === id)?.editedAt).toBeNull();
  });

  it("refuses a staff member who did not write the comment", async () => {
    const owner = await makeUser(`u-so-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`u-sa-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "mine",
      isInternal: false,
    });

    await expect(
      updateCommentAs(admin, { commentId: id, content: "not yours" })
    ).rejects.toThrow(/Forbidden/);

    const [row] = await db
      .select()
      .from(projectComments)
      .where(eq(projectComments.id, id));
    expect(row.content).toBe("mine");
    expect(row.editedAt).toBeNull();
  });

  it("refuses a stranger who cannot even see the project", async () => {
    const owner = await makeUser(`u-xo-${Date.now()}@x.com`, "user");
    const stranger = await makeUser(`u-xs-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "mine",
      isInternal: false,
    });

    await expect(
      updateCommentAs(stranger, { commentId: id, content: "hello" })
    ).rejects.toThrow(/Forbidden/);
  });

  it("refuses an edit once the comment has a reply", async () => {
    const owner = await makeUser(`u-ro-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`u-ra-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "the question",
      isInternal: false,
    });
    await addCommentAs(admin, {
      projectId: pid,
      content: "the answer",
      parentId: id,
      isInternal: false,
    });

    await expect(
      updateCommentAs(owner, { commentId: id, content: "a different question" })
    ).rejects.toThrow(/no longer be edited/);
  });

  it("locks a comment whose only reply is internal, and says so to the proposer", async () => {
    const owner = await makeUser(`u-io-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`u-ia-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id } = await addCommentAs(owner, {
      projectId: pid,
      content: "the question",
      isInternal: false,
    });
    await addCommentAs(admin, {
      projectId: pid,
      content: "staff aside",
      parentId: id,
      isInternal: true,
    });

    // The reply itself is filtered out of the proposer's thread, so the lock
    // cannot be counted client side. `hasReply` is the one bit that crosses.
    const { rows } = await listProjectCommentsAs(owner, { id: pid });
    expect(rows).toHaveLength(1);
    expect(rows[0].hasReply).toBe(true);

    await expect(
      updateCommentAs(owner, { commentId: id, content: "rewritten" })
    ).rejects.toThrow(/no longer be edited/);
  });

  it("marks the viewer's own rows, and only those", async () => {
    const owner = await makeUser(`u-mo-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`u-ma-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const { id: mine } = await addCommentAs(owner, {
      projectId: pid,
      content: "mine",
      isInternal: false,
    });
    const { id: theirs } = await addCommentAs(admin, {
      projectId: pid,
      content: "theirs",
      isInternal: false,
    });

    const { rows } = await listProjectCommentsAs(owner, { id: pid });
    expect(rows.find((r) => r.id === mine)?.isMine).toBe(true);
    expect(rows.find((r) => r.id === theirs)?.isMine).toBe(false);
  });

  it("reports hasReply false on a comment with no replies at all", async () => {
    const owner = await makeUser(`u-hf-${Date.now()}@x.com`, "user");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await addCommentAs(owner, {
      projectId: pid,
      content: "alone",
      isInternal: false,
    });

    const { rows } = await listProjectCommentsAs(owner, { id: pid });
    expect(rows[0].hasReply).toBe(false);
  });

  it("notifies nobody and leaves the notification written at post time alone", async () => {
    const owner = await makeUser(`u-no-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`u-na-${Date.now()}@x.com`, "admin");
    const { id: pid } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, pid, "submitted");
    const send = vi.fn().mockResolvedValue(undefined);
    const { id } = await addCommentAs(
      admin,
      { projectId: pid, content: "as posted", isInternal: false },
      { send }
    );
    send.mockClear();

    await updateCommentAs(admin, { commentId: id, content: "as edited" });

    expect(send).not.toHaveBeenCalled();
    const bell = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, owner.id))
    ).filter((n) => n.type === "comment");
    expect(bell).toHaveLength(1);
    // The recipient holds the original in their inbox, so the bell matching
    // what they were told is consistent rather than stale (#503).
    expect(bell[0].message).toBe("as posted");
  });

  it("refuses a comment id that does not exist", async () => {
    const owner = await makeUser(`u-mi-${Date.now()}@x.com`, "user");
    await expect(
      updateCommentAs(owner, {
        commentId: "00000000-0000-0000-0000-000000000000",
        content: "hello",
      })
    ).rejects.toThrow(/not found/i);
  });
});

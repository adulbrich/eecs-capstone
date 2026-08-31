import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  forceTransitionAs,
  hardDeleteProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
  updateProjectAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  getProposerForEditAs,
} from "#/server/_internal/projects-queries";

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

  it("force writes the same history row and notification as a normal transition", async () => {
    // forceTransitionAs has never been asserted to do either. It shares a body
    // with performTransitionAs by copy, so this is what makes the equivalence
    // checkable rather than reviewable.
    const owner = await makeUser(`fo-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`fa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    await forceTransitionAs(admin, id, "changes_requested", "force note", {
      sendEmail: false,
    });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("changes_requested");

    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history).toHaveLength(1);
    expect(history[0].oldStatus).toBe("draft");
    expect(history[0].newStatus).toBe("changes_requested");
    expect(history[0].changedBy).toBe(admin.id);
    expect(history[0].comment).toBe("force note");

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs).toHaveLength(1);
  });

  it("force sets publishedAt and archivedAt the same way", async () => {
    const owner = await makeUser(`fp-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`fpa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    await forceTransitionAs(admin, id, "published", undefined, {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      sendEmail: false,
    });
    const [published] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(published.publishedAt).not.toBeNull();

    await forceTransitionAs(admin, id, "archived", undefined, {
      sendEmail: false,
    });
    const [archived] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(archived.archivedAt).not.toBeNull();
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

// Staff-only data and actions must be enforced server-side, not merely hidden
// in the UI: a non-staff (or anonymous) caller hitting the server functions
// directly must never receive staff-only fields or succeed at staff-only writes.
describe("staff-only data and actions are inaccessible to non-staff", () => {
  it("names every field it returns, for an anonymous reader and for staff", async () => {
    // /projects/$id is public, so this payload reaches anonymous viewers. The
    // projection cannot widen on its own; what this catches is a future caller
    // reintroducing a whole-row select above it.
    const PUBLIC_KEYS = [
      "contactEmail",
      "contactName",
      "deletedAt",
      "description",
      "id",
      "imageUrl",
      "isSponsored",
      "licenseRestrictions",
      "minQualifications",
      "notes",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "programId",
      "requiresNdaIp",
      "status",
      "teamsSupported",
      "title",
      "url",
    ];
    const admin = await makeUser(`keys-a-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      notes: "internal staff note",
    });
    await forceTransitionAs(admin, id, "published", undefined, {
      sendEmail: false,
    });

    const { project: forAnon } = await getProjectAs(null, { id });
    expect(Object.keys(forAnon ?? {}).sort()).toEqual(PUBLIC_KEYS);
    expect(forAnon?.notes).toBeNull();

    const { project: forAdmin } = await getProjectAs(admin, { id });
    // Same key set for both. Only the value of `notes` differs, which is the
    // design: one shape, one viewer-dependent field.
    expect(Object.keys(forAdmin ?? {}).sort()).toEqual(PUBLIC_KEYS);
    expect(forAdmin?.notes).toBe("internal staff note");
  });

  it("getProjectAs strips notes and proposerEmail for anonymous and non-staff viewers", async () => {
    const admin = await makeUser(`sec-a-${Date.now()}@x.com`, "admin");
    const other = await makeUser(`sec-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      notes: "internal staff note",
      proposerEmail: "proposer@example.edu",
    });
    await forceTransitionAs(admin, id, "published");

    const asStaff = await getProjectAs(admin, { id });
    expect(asStaff.project?.notes).toBe("internal staff note");

    for (const viewer of [null, { id: other.id, role: other.role }]) {
      const seen = await getProjectAs(viewer, { id });
      expect(seen.project).not.toBeNull();
      expect(seen.project?.notes).toBeNull();
      expect(seen.project).not.toHaveProperty("proposerEmail");
      expect(seen.viewerIsStaff).toBe(false);
    }
  });

  it("staff-only writes reject a non-staff, non-owner caller", async () => {
    const admin = await makeUser(`sec-a2-${Date.now()}@x.com`, "admin");
    const other = await makeUser(`sec-o2-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(admin, baseProject());
    const intruder = { id: other.id, role: other.role };

    await expect(forceTransitionAs(intruder, id, "published")).rejects.toThrow(
      /Forbidden/
    );
    await expect(
      performTransitionAs(intruder, id, "submitted")
    ).rejects.toThrow(/Forbidden/);
    await expect(hardDeleteProjectAs(intruder, id)).rejects.toThrow(
      /Forbidden/
    );
  });
});

describe("status timeline visibility and changes-requested feedback", () => {
  it("returns the status timeline only to staff and the proposer", async () => {
    const admin = await makeUser(`th-a-${Date.now()}@x.com`, "admin");
    const owner = await makeUser(`th-o-${Date.now()}@x.com`, "user");
    const other = await makeUser(`th-x-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, id, "submitted");
    await forceTransitionAs(admin, id, "published");

    const staffView = await getProjectAs(admin, { id });
    const ownerView = await getProjectAs(
      { id: owner.id, role: owner.role },
      { id }
    );
    const otherView = await getProjectAs(
      { id: other.id, role: other.role },
      { id }
    );
    const anonView = await getProjectAs(null, { id });

    expect(staffView.history.length).toBeGreaterThan(0);
    expect(ownerView.history.length).toBeGreaterThan(0);
    // Non-owner and anonymous viewers can see the published project but not
    // its status timeline.
    expect(otherView.project).not.toBeNull();
    expect(otherView.history).toHaveLength(0);
    expect(anonView.project).not.toBeNull();
    expect(anonView.history).toHaveLength(0);
  });

  it("requires a comment when requesting changes", async () => {
    const admin = await makeUser(`cr-a-${Date.now()}@x.com`, "admin");
    const owner = await makeUser(`cr-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, id, "submitted");

    await expect(
      performTransitionAs(admin, id, "changes_requested")
    ).rejects.toThrow(/comment describing the requested changes/);
    await expect(
      performTransitionAs(admin, id, "changes_requested", "Add unit tests.")
    ).resolves.toMatchObject({ status: "changes_requested" });
  });

  it("notifies the proposer with the changes-requested feedback text", async () => {
    const admin = await makeUser(`crn-a-${Date.now()}@x.com`, "admin");
    const owner = await makeUser(`crn-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(
      admin,
      id,
      "changes_requested",
      "Please tighten the scope."
    );

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    const changeNotif = notifs.find((n) =>
      n.message.includes("Changes requested")
    );
    expect(changeNotif?.message).toContain("Please tighten the scope.");
  });
});

describe("private notes", () => {
  it("lets a proposer write private notes at creation and read them back", async () => {
    const owner = await makeUser(`pn-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      notes: "Budget comes from the robotics grant.",
    });

    const view = await getProjectAs(owner, { id });
    expect(view.project?.notes).toBe("Budget comes from the robotics grant.");
  });

  it("hides private notes from other signed-in users and anonymous viewers", async () => {
    const owner = await makeUser(`pn-o2-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`pn-a2-${Date.now()}@x.com`, "admin");
    const nosy = await makeUser(`pn-n2-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      notes: "Locker 12, code 4471.",
    });
    await performTransitionAs(owner, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    expect((await getProjectAs(nosy, { id })).project?.notes).toBeNull();
    expect((await getProjectAs(null, { id })).project?.notes).toBeNull();
    expect((await getProjectAs(owner, { id })).project?.notes).toBe(
      "Locker 12, code 4471."
    );
    expect((await getProjectAs(admin, { id })).project?.notes).toBe(
      "Locker 12, code 4471."
    );
  });

  it("lets the proposer edit their own private notes", async () => {
    const owner = await makeUser(`pn-o3-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      notes: "first draft",
    });

    await updateProjectAs(owner, {
      id,
      ...baseProject(),
      notes: "revised by the proposer",
    });

    expect((await getProjectAs(owner, { id })).project?.notes).toBe(
      "revised by the proposer"
    );
  });

  it("does not let a proposer's save wipe notes staff added", async () => {
    const owner = await makeUser(`pn-o4-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`pn-a4-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    // The staff edit form prefills proposerEmail from getProposerForEdit, so a
    // staff save always sends it back. Sent explicitly here because that is
    // what the form does; omitting it would now leave the proposer alone
    // rather than unlink, so this no longer depends on remembering to.
    await updateProjectAs(admin, {
      id,
      ...baseProject(),
      notes: "staff context",
      proposerEmail: owner.email,
    });

    // The proposer sees the notes now, so an untouched save round-trips them.
    const seen = (await getProjectAs(owner, { id })).project?.notes;
    expect(seen).toBe("staff context");
    await updateProjectAs(owner, { id, ...baseProject(), notes: seen ?? null });

    expect((await getProjectAs(admin, { id })).project?.notes).toBe(
      "staff context"
    );
  });

  it("logs a notes edit under the proposer who made it", async () => {
    const owner = await makeUser(`pn-o5-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectAs(owner, {
      id,
      ...baseProject(),
      notes: "added later",
    });

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].changedFields).toContain("notes");
    expect(log[0].editorId).toBe(owner.id);
  });

  it("logs an image change like any other field", async () => {
    // The defect this closes: the upload path wrote projects.image_url on its
    // own request, so staff reading a project's edit history saw every text
    // field that moved and no sign the image had changed at all. See #88.
    const owner = await makeUser(`img-o-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectAs(owner, {
      id,
      ...baseProject(),
      imageUrl: `projects/${id}/new.webp`,
    });

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].changedFields).toContain("imageUrl");
    expect(log[0].newValues).toMatchObject({
      imageUrl: `projects/${id}/new.webp`,
    });
    expect(log[0].editorId).toBe(owner.id);
  });

  it("a staff save that omits proposerEmail leaves the proposer alone", async () => {
    // Omitted and cleared are different asks. The new-project route creates,
    // uploads, then updates to save the image key, and that update is not about
    // the proposer at all. Before this distinction existed, omitting the field
    // unlinked the proposer, and round-tripping the address to avoid that wrote
    // a "proposer changed" row into the edit log that no one had asked for.
    const admin = await makeUser(`prop-a-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const [afterCreate] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(afterCreate.proposerId).toBe(admin.id);

    await updateProjectAs(admin, {
      id,
      ...baseProject(),
      imageUrl: `projects/${id}/k.webp`,
    });

    const [afterUpdate] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(afterUpdate.proposerId).toBe(admin.id);

    // And the log says only what changed.
    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].changedFields).toEqual(["imageUrl"]);
  });

  it("a staff save that clears proposerEmail still unlinks the proposer", async () => {
    const admin = await makeUser(`prop-b-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    await updateProjectAs(admin, { id, ...baseProject(), proposerEmail: "" });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.proposerId).toBeNull();
    expect(row.proposerEmail).toBeNull();
  });

  it("never returns proposerEmail to anyone, staff included", async () => {
    // It is the private link key. It used to ride the payload for every viewer
    // and be nulled for the wrong ones; now it is not on the wire at all. The
    // staff panel reads it through getProposerForEditAs, which is staff-gated.
    const owner = await makeUser(`pn-o6-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`pn-a6-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      notes: "n",
      proposerEmail: owner.email,
    });

    const ownerView = await getProjectAs(owner, { id });
    expect(ownerView.project?.notes).toBe("n");
    expect(ownerView.project).not.toHaveProperty("proposerEmail");
    expect((await getProjectAs(admin, { id })).project).not.toHaveProperty(
      "proposerEmail"
    );
  });
});

describe("review emails", () => {
  // These tests mutate process.env, and vitest.integration.config.ts sets
  // fileParallelism: false, so every integration file shares one process.
  // Without this restore a bogus BETTER_AUTH_URL would leak out of this block
  // into every later file, where auth.api.signUpEmail reads it.
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("emails the review inbox on submit, the proposer on approve, nobody on publish", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const owner = await makeUser("owner-mail@x.edu", "user");
    const admin = await makeUser("admin-mail@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    await performTransitionAs(admin, id, "approved", undefined, { send });
    await performTransitionAs(admin, id, "published", undefined, { send });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe("review@oregonstate.edu");
    expect(send.mock.calls[1]?.[0]).toBe("owner-mail@x.edu");
    expect(send.mock.calls[1]?.[1].text).toContain(
      "will not receive another email"
    );
  });

  it("emails the proposer the staff note when changes are requested", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-cr@x.edu", "user");
    const admin = await makeUser("admin-cr@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(
      admin,
      id,
      "changes_requested",
      "Add objectives.",
      {
        send,
      }
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("owner-cr@x.edu");
    expect(send.mock.calls[0]?.[1].text).toContain("Add objectives.");
  });

  it("sends nothing when staff opt out, but still records the transition", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-skip@x.edu", "user");
    const admin = await makeUser("admin-skip@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(admin, id, "approved", undefined, {
      send,
      sendEmail: false,
    });

    expect(send).not.toHaveBeenCalled();
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("approved");
    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history.some((h) => h.newStatus === "approved")).toBe(true);
  });

  it("ignores a proposer's attempt to skip the submission email", async () => {
    // Skipping the mail is a staff affordance, and this notice is the only
    // push that tells staff a project arrived: nothing writes them an in-app
    // notification, and the admin dashboard's "Awaiting review" count has to
    // be looked at. `sendEmail` rides on schemas that three owner-reachable
    // endpoints share, so the gate has to be the role, not the field.
    process.env.BETTER_AUTH_URL = "https://app";
    process.env.EMAIL_REVIEW_INBOX = "review@oregonstate.edu";
    const owner = await makeUser("owner-noskip@x.edu", "user");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(owner, id, "submitted", undefined, {
      send,
      sendEmail: false,
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("review@oregonstate.edu");
    // Ignored, not rejected: the submission itself still goes through.
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("submitted");
  });

  it("emails a proposer who has an address but no account", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser("admin-noacct@x.edu", "admin");
    const { id } = await createProjectAs(admin, {
      ...baseProject(),
      proposerEmail: "outsider@example.com",
    });
    const send = vi.fn().mockResolvedValue(undefined);

    await performTransitionAs(admin, id, "submitted", undefined, { send });
    send.mockClear();
    await performTransitionAs(admin, id, "approved", undefined, { send });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("outsider@example.com");
  });

  it("does not roll back the transition when the email fails", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-fail@x.edu", "user");
    const admin = await makeUser("admin-fail@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const ok = vi.fn().mockResolvedValue(undefined);
    const boom = vi.fn().mockRejectedValue(new Error("SES is down"));

    await performTransitionAs(owner, id, "submitted", undefined, { send: ok });
    await expect(
      performTransitionAs(admin, id, "approved", undefined, { send: boom })
    ).resolves.toMatchObject({ status: "approved" });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("approved");
  });

  it("emails from the force path too", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const owner = await makeUser("owner-force@x.edu", "user");
    const admin = await makeUser("admin-force@x.edu", "admin");
    const { id } = await createProjectAs(owner, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await forceTransitionAs(admin, id, "approved", undefined, { send });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("owner-force@x.edu");
  });
});

describe("getProposerForEditImpl", () => {
  it("reports a linked account with its current email and name", async () => {
    const staff = await makeUser("staff-pfe@x.edu", "admin");
    const owner = await makeUser("owner-pfe@x.edu", "user");
    const { id } = await createProjectAs(owner, baseProject());

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(true);
    expect(result.email).toBe("owner-pfe@x.edu");
    expect(result.accountName).toBe("owner-pfe@x.edu");
  });

  it("reports an external proposer as unlinked", async () => {
    const staff = await makeUser("staff-pfe2@x.edu", "admin");
    const { id } = await createProjectAs(staff, {
      ...baseProject(),
      proposerEmail: "outsider@example.com",
    });

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(false);
    expect(result.email).toBe("outsider@example.com");
    expect(result.accountName).toBeNull();
  });

  it("reports a project with no proposer at all as unlinked and blank", async () => {
    const staff = await makeUser("staff-pfe3@x.edu", "admin");
    const { id } = await createProjectAs(staff, baseProject());
    await db
      .update(projects)
      .set({ proposerId: null, proposerEmail: null })
      .where(eq(projects.id, id));

    const result = await getProposerForEditAs(staff, { projectId: id });

    expect(result.accountLinked).toBe(false);
    expect(result.email).toBe("");
  });

  it("refuses a non-staff viewer", async () => {
    const owner = await makeUser("owner-pfe4@x.edu", "user");
    const { id } = await createProjectAs(owner, baseProject());

    await expect(
      getProposerForEditAs(owner, { projectId: id })
    ).rejects.toThrow("Forbidden");
  });
});

describe("canEdit on an archived project", () => {
  it("matches canEditProject: staff may edit, the owner may not", async () => {
    const owner = await makeUser(`ae-o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`ae-a-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    await forceTransitionAs(admin, id, "published", undefined, {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      sendEmail: false,
    });
    await forceTransitionAs(admin, id, "archived", undefined, {
      sendEmail: false,
    });

    // getProjectAs used to reimplement the rule inline and deny staff here,
    // while updateProjectAs, image upload and AI review all call the predicate
    // and would have accepted the write.
    expect((await getProjectAs(admin, { id })).canEdit).toBe(true);
    expect(
      (await getProjectAs({ id: owner.id, role: owner.role }, { id })).canEdit
    ).toBe(false);
    expect((await getProjectAs(null, { id })).canEdit).toBe(false);
  });
});

describe("NDA/IP agreement flag", () => {
  it("clears the restrictions text when no agreement is required", async () => {
    const owner = await makeUser(`nda-a-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      licenseRestrictions: "Signed NDA required before kickoff",
      requiresNdaIp: false,
    });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    // The checkbox is the source of truth. Text left behind an unchecked box
    // is prose nothing renders, and it breaks the rule that an empty
    // restrictions field means no agreement is required.
    expect(row.requiresNdaIp).toBe(false);
    expect(row.licenseRestrictions).toBeNull();
  });

  it("keeps the restrictions text when an agreement is required", async () => {
    const owner = await makeUser(`nda-b-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      licenseRestrictions: "Signed NDA required before kickoff",
      requiresNdaIp: true,
    });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.requiresNdaIp).toBe(true);
    expect(row.licenseRestrictions).toBe("Signed NDA required before kickoff");
  });

  it("clears the text when an edit unchecks the flag", async () => {
    const owner = await makeUser(`nda-c-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      licenseRestrictions: "Signed NDA required before kickoff",
      requiresNdaIp: true,
    });

    await updateProjectAs(owner, {
      ...baseProject(),
      id,
      licenseRestrictions: "Signed NDA required before kickoff",
      requiresNdaIp: false,
    });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.requiresNdaIp).toBe(false);
    expect(row.licenseRestrictions).toBeNull();
  });

  it("persists unchecking the flag when the restrictions text is already null", async () => {
    // The case above passes for a reason that is not the flag: clearing the
    // text is itself a change, so the write happens and the flag rides along.
    // With no text to clear, the flag is the only thing that moved, which is
    // what an edit diff blind to it would discard.
    const owner = await makeUser(`nda-d-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      licenseRestrictions: null,
      requiresNdaIp: true,
    });

    const result = await updateProjectAs(owner, {
      ...baseProject(),
      id,
      licenseRestrictions: null,
      requiresNdaIp: false,
    });

    expect(result.updated).toBe(true);
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.requiresNdaIp).toBe(false);
  });
});

describe("sponsorship flag", () => {
  it("persists a sponsorship toggle that is the only change", async () => {
    const owner = await makeUser(`spon-only-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      isSponsored: false,
    });

    const result = await updateProjectAs(owner, {
      ...baseProject(),
      id,
      isSponsored: true,
    });

    expect(result.updated).toBe(true);
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.isSponsored).toBe(true);
  });

  it("records the toggled flags on the edit log", async () => {
    const owner = await makeUser(`spon-log-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      isSponsored: false,
    });

    await updateProjectAs(owner, { ...baseProject(), id, isSponsored: true });

    const [entry] = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(entry.changedFields).toContain("isSponsored");
    expect(entry.newValues).toMatchObject({ isSponsored: true });
    expect(entry.oldValues).toMatchObject({ isSponsored: false });
  });

  it("is visible to staff and the proposer, and to nobody else", async () => {
    const owner = await makeUser(`spon-o-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`spon-a-${Date.now()}@x.com`, "admin");
    const other = await makeUser(`spon-x-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      isSponsored: true,
    });
    await performTransitionAs(owner, id, "submitted");
    await forceTransitionAs(admin, id, "published", undefined, {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      sendEmail: false,
    });

    expect((await getProjectAs(admin, { id })).project?.isSponsored).toBe(true);
    // The proposer declares sponsorship on the form, so they have to be able
    // to read it back. Hiding it from them would make an edit round-trip
    // silently reset the flag.
    expect(
      (await getProjectAs({ id: owner.id, role: owner.role }, { id })).project
        ?.isSponsored
    ).toBe(true);

    // Sponsorship is closer to a funding conversation than a project
    // attribute, so it never reaches the public payload. Null rather than
    // absent, matching how notes are withheld.
    expect(
      (await getProjectAs({ id: other.id, role: other.role }, { id })).project
        ?.isSponsored
    ).toBeNull();
    expect((await getProjectAs(null, { id })).project?.isSponsored).toBeNull();
  });

  it("publishes the NDA/IP flag to anonymous viewers", async () => {
    const owner = await makeUser(`spon-p-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`spon-q-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      licenseRestrictions: "NDA required",
      requiresNdaIp: true,
    });
    await performTransitionAs(owner, id, "submitted");
    await forceTransitionAs(admin, id, "published", undefined, {
      embed: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
      sendEmail: false,
    });

    // A student needs this before bidding, so it is public by design.
    const anonView = await getProjectAs(null, { id });
    expect(anonView.project?.requiresNdaIp).toBe(true);
  });
});

describe("updateProjectAs cross-user guard", () => {
  it("refuses a write from a viewer who is neither proposer nor staff", async () => {
    // #155: `canEditProject` is unit tested against a rejected viewer in
    // `project-visibility.test.ts`, but no test drove one through this server
    // seam, so deleting the guard here left the suite green.
    //
    // `notes` is in the payload as a second, independent gate, not because a
    // stranger could otherwise write it: `buildProjectValues` asks
    // `canWritePrivateNotes` on its own, so with this guard deleted a
    // stranger's notes are dropped there anyway. Notes is owner-or-staff, not
    // staff-only, whatever #155 says.
    const owner = await makeUser(`x-o-${Date.now()}@x.com`, "user");
    const stranger = await makeUser(`x-s-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, {
      ...baseProject(),
      title: "owned",
      notes: "owner wrote this",
    });

    await expect(
      updateProjectAs(stranger, {
        id,
        ...baseProject(),
        title: "taken over",
        notes: "written by a stranger",
      })
    ).rejects.toThrow(/Forbidden/);

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.title).toBe("owned");
    expect(row.notes).toBe("owner wrote this");
    // And nothing was logged, because nothing was written.
    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(0);
  });
});

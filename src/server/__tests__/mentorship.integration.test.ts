import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { programs, projectEditLog, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  adminProjectSummarySelect,
  projectSummarySelect,
} from "#/server/_internal/project-summary";
import {
  createProjectAs,
  forceTransitionAs,
  performTransitionAs,
  softDeleteProjectAs,
  updateProjectAs,
  updateProjectMentorshipAs,
  updateProjectProposerAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  getProjectMentorshipAs,
  getProposerForEditAs,
  listMentoredProjectsAs,
} from "#/server/_internal/projects-queries";

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: `Name of ${email}` },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role, email: u.email, name: u.name };
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

async function columns(id: string) {
  const [row] = await db
    .select({
      mentorEmail: projects.mentorEmail,
      mentorNeed: projects.mentorNeed,
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, id));
  return row;
}

describe("updateProjectMentorshipAs", () => {
  it("refuses a non-staff viewer, the proposer included", async () => {
    const owner = await makeUser(`mo-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await expect(
      updateProjectMentorshipAs(owner, {
        id,
        mentorEmail: "m@x.com",
        mentorNeed: "seeking",
      })
    ).rejects.toThrow("Forbidden");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      mentorNeed: "unspecified",
      studentProposed: false,
    });
  });

  it("writes both columns and one edit log row, and an unchanged save writes none", async () => {
    const admin = await makeUser(`ma-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    const first = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "  Mentor@X.com ",
      mentorNeed: "seeking",
    });
    expect(first.updated).toBe(true);
    // Trimmed and lowercased, since #249 chose to normalize on write.
    expect(await columns(id)).toEqual({
      mentorEmail: "mentor@x.com",
      mentorNeed: "seeking",
      studentProposed: false,
    });

    // A save that differs only in case now finds no changed field, so it
    // writes no row and no edit log entry. That is the cost of normalizing
    // on write, recorded in QUIRKS rather than worked around here.
    const again = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "MENTOR@x.com",
      mentorNeed: "seeking",
    });
    expect(again.updated).toBe(false);

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].editorId).toBe(admin.id);
    expect(log[0].changedFields).toEqual(["mentorNeed", "mentorEmail"]);
  });

  it("leaves the student-proposed mark to the proposer endpoint, one edit log row per save", async () => {
    const admin = await makeUser(`msp-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const marked = await updateProjectProposerAs(admin, {
      id,
      proposerEmail: admin.email,
      studentProposed: true,
    });
    expect(marked.updated).toBe(true);
    expect((await columns(id)).studentProposed).toBe(true);
    // A mentorship save beside it does not touch the mark.
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      mentorNeed: "seeking",
    });
    expect((await columns(id)).studentProposed).toBe(true);
    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    // The first row may also carry the address the link resolved to; the
    // mark is what this asserts, and the mentorship row never carries it.
    expect(log).toHaveLength(2);
    expect(log[0].changedFields).toContain("studentProposed");
    expect(log[1].changedFields).toEqual(["mentorNeed"]);
    expect(
      (await getProposerForEditAs(admin, { projectId: id })).studentProposed
    ).toBe(true);
  });

  it("clears the address when given an empty string", async () => {
    const admin = await makeUser(`mc-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "m@x.com",
      mentorNeed: "unspecified",
    });
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      mentorNeed: "unspecified",
    });
    expect((await columns(id)).mentorEmail).toBeNull();
  });

  it("is unreachable through updateProjectAs, even for staff", async () => {
    const admin = await makeUser(`mu-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    // Extra keys on the ordinary edit payload. `ProjectInput` has no room for
    // them, so they must fall on the floor rather than be written.
    const smuggled = {
      ...baseProject(),
      id,
      mentorEmail: "smuggled@x.com",
      mentorNeed: "seeking" as const,
      studentProposed: true,
    };
    await updateProjectAs(admin, smuggled);
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      mentorNeed: "unspecified",
      studentProposed: false,
    });
  });
});

describe("the six public states", () => {
  async function publishedProject() {
    const admin = await makeUser(
      `mp-${Date.now()}-${Math.random()}@x.com`,
      "admin"
    );
    const { id } = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, id, "published", undefined, {
      sendEmail: false,
    });
    return { admin, id };
  }

  // The Decisions table on #304, one row per combination staff can record.
  // The address rows say "recorded, no account": the name is a separate
  // test below. `seekingMentor` is the derived badge, never the stored flag.
  it.each([
    {
      studentProposed: true,
      mentorNeed: "seeking" as const,
      mentorEmail: "",
      badge: true,
    },
    {
      studentProposed: true,
      mentorNeed: "seeking" as const,
      mentorEmail: "m@x.com",
      badge: false,
    },
    {
      studentProposed: true,
      mentorNeed: "unspecified" as const,
      mentorEmail: "",
      badge: false,
    },
    {
      studentProposed: false,
      mentorNeed: "seeking" as const,
      mentorEmail: "",
      badge: true,
    },
    {
      studentProposed: false,
      mentorNeed: "seeking" as const,
      mentorEmail: "m@x.com",
      badge: false,
    },
    {
      studentProposed: false,
      mentorNeed: "unspecified" as const,
      mentorEmail: "",
      badge: false,
    },
  ])(
    "student $studentProposed, state $mentorNeed, address '$mentorEmail' shows the seeking badge: $badge",
    async ({ studentProposed, mentorNeed, mentorEmail, badge }) => {
      const { admin, id } = await publishedProject();
      // Two writers since #336: the mark travels with the proposer link.
      await updateProjectProposerAs(admin, {
        id,
        proposerEmail: admin.email,
        studentProposed,
      });
      await updateProjectMentorshipAs(admin, {
        id,
        mentorEmail,
        mentorNeed,
      });
      const { project } = await getProjectAs(null, { id });
      expect(project?.studentProposed).toBe(studentProposed);
      expect(project?.seekingMentor).toBe(badge);
      expect("mentorEmail" in (project ?? {})).toBe(false);
      expect("mentorName" in (project ?? {})).toBe(false);
      expect("seekingMentor" in (project ?? {})).toBe(true);
    }
  );

  it("starts with nothing set", async () => {
    const { id } = await publishedProject();
    const { project } = await getProjectAs(null, { id });
    expect(project?.studentProposed).toBe(false);
    expect(project?.seekingMentor).toBe(false);
    expect(project?.noMentorNeeded).toBe(false);
    expect("mentorName" in (project ?? {})).toBe(false);
  });

  it("shows No mentor needed for the none state, and never the seeking badge with it", async () => {
    const { admin, id } = await publishedProject();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      mentorNeed: "none",
    });
    const { project } = await getProjectAs(null, { id });
    expect(project?.noMentorNeeded).toBe(true);
    expect(project?.seekingMentor).toBe(false);
    expect("mentorNeed" in (project ?? {})).toBe(false);
    const [row] = await db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(eq(projects.id, id));
    expect(row.noMentorNeeded).toBe(true);
    expect("mentorNeed" in row).toBe(false);
  });

  it("refuses an address beside the none state, in both orders, and writes nothing", async () => {
    const { admin, id } = await publishedProject();
    // State first, then an address: the state is what the reader has to clear.
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      mentorNeed: "none",
    });
    await expect(
      updateProjectMentorshipAs(admin, {
        id,
        mentorEmail: "m@x.com",
        mentorNeed: "none",
      })
    ).rejects.toThrow("Clear No mentor needed before recording a mentor.");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      mentorNeed: "none",
      studentProposed: false,
    });
    // Address first, then the state: the address is what to remove.
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "m@x.com",
      mentorNeed: "unspecified",
    });
    await expect(
      updateProjectMentorshipAs(admin, {
        id,
        mentorEmail: "m@x.com",
        mentorNeed: "none",
      })
    ).rejects.toThrow("Remove the mentor before marking No mentor needed.");
    expect(await columns(id)).toEqual({
      mentorEmail: "m@x.com",
      mentorNeed: "unspecified",
      studentProposed: false,
    });
    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    // Two accepted saves, two refusals that wrote no row.
    expect(log).toHaveLength(2);
  });

  it("shows the public nothing about a recorded mentor, before or after they sign up", async () => {
    const { admin, id } = await publishedProject();
    const stamp = Date.now();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: `Mentor-${stamp}@X.com`,
      mentorNeed: "seeking" as const,
    });
    let { project } = await getProjectAs(null, { id });
    expect(project?.seekingMentor).toBe(false);
    expect("mentorEmail" in (project ?? {})).toBe(false);
    expect("mentorName" in (project ?? {})).toBe(false);

    // The name resolves case-insensitively once the account exists, and it
    // resolves for staff only (#336): the public read still says nothing.
    const mentor = await makeUser(`mentor-${stamp}@x.com`, "user");
    ({ project } = await getProjectAs(null, { id }));
    expect("mentorName" in (project ?? {})).toBe(false);
    expect(project?.seekingMentor).toBe(false);
    expect(
      (await getProjectMentorshipAs(admin, { projectId: id })).mentorName
    ).toBe(mentor.name);
    const [staffRow] = await db
      .select(adminProjectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .leftJoin(user, eq(projects.proposerId, user.id))
      .where(eq(projects.id, id));
    expect(staffRow.mentorName).toBe(mentor.name);
  });

  it("reaches the shared listing projection", async () => {
    const { admin, id } = await publishedProject();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      mentorNeed: "seeking" as const,
    });
    const [row] = await db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(eq(projects.id, id));
    expect(row.studentProposed).toBe(false);
    expect(row.seekingMentor).toBe(true);
    expect("mentorName" in row).toBe(false);
    expect("mentorEmail" in row).toBe(false);
  });

  it("never carries the address for the proposer either", async () => {
    const owner = await makeUser(`mown-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`madm-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "private@x.com",
      mentorNeed: "unspecified" as const,
    });
    const { project } = await getProjectAs(owner, { id });
    expect(project).not.toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);
  });
});

describe("listMentoredProjectsAs", () => {
  it("lists every live project naming the viewer's address, any status, matched case-insensitively", async () => {
    const admin = await makeUser("admin-mentoring@x.edu", "admin");
    // Sign-up folds the address; the case test is the column against the lookup.
    const mentor = await makeUser("mentor-person@x.edu", "user");
    const bystander = await makeUser("bystander-mentoring@x.edu", "user");
    const draft = await createProjectAs(admin, baseProject());
    const live = await createProjectAs(admin, baseProject());
    const gone = await createProjectAs(admin, baseProject());
    const other = await createProjectAs(admin, baseProject());
    for (const { id } of [draft, live, gone]) {
      await updateProjectMentorshipAs(admin, {
        id,
        mentorEmail: "MENTOR-person@x.edu",
        mentorNeed: "unspecified",
      });
    }
    await performTransitionAs(admin, live.id, "submitted");
    await performTransitionAs(admin, live.id, "approved");
    await performTransitionAs(admin, live.id, "published");
    await performTransitionAs(admin, gone.id, "submitted");
    await softDeleteProjectAs(admin, gone.id);

    // The account's address as sign-up folded it, against a column written
    // in another case.
    const rows = await listMentoredProjectsAs({ email: mentor.email });
    expect(rows.map((r) => r.id).sort()).toEqual([draft.id, live.id].sort());
    // The public summary, so nothing about the mentor rides along.
    expect(Object.keys(rows[0] ?? {})).not.toContain("mentorEmail");
    expect(Object.keys(rows[0] ?? {})).not.toContain("mentorName");
    expect(rows.some((r) => r.id === other.id)).toBe(false);
    expect(await listMentoredProjectsAs({ email: bystander.email })).toEqual(
      []
    );

    // Changing the mentor drops the project silently.
    await updateProjectMentorshipAs(admin, {
      id: draft.id,
      mentorEmail: "someone-else@x.edu",
      mentorNeed: "unspecified",
    });
    expect(
      (await listMentoredProjectsAs({ email: mentor.email })).map((r) => r.id)
    ).toEqual([live.id]);
  });
});

describe("getProjectMentorshipAs", () => {
  it("returns the stored address and the resolved name to staff, and Forbidden to anyone else", async () => {
    const owner = await makeUser(`go-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`ga-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: "",
      mentorName: null,
      mentorNeed: "unspecified",
    });

    // Typed with capitals, stored without them, and the name still resolves:
    // mentorNameSql matches the normalized column against user.email, which
    // Better Auth lowercases on every path that creates an account (#249).
    // The staff read carries the stored flag even while an address is on
    // file; only the public badge is guarded by the address.
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: owner.email.toUpperCase(),
      mentorNeed: "seeking",
    });
    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: owner.email,
      mentorName: owner.name,
      mentorNeed: "seeking",
    });

    await expect(
      getProjectMentorshipAs(owner, { projectId: id })
    ).rejects.toThrow("Forbidden");
    await expect(
      getProjectMentorshipAs(null, { projectId: id })
    ).rejects.toThrow("Forbidden");
  });
});

describe("mentor email", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("skips the email on sendEmail: false and still writes the address, and mails staff who name themselves", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser("admin-mentor-skip@x.edu", "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await updateProjectMentorshipAs(
      admin,
      {
        id,
        mentorEmail: "quiet-mentor@example.edu",
        mentorNeed: "unspecified",
      },
      { send, sendEmail: false }
    );
    expect(result.updated).toBe(true);
    expect(send).not.toHaveBeenCalled();
    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.mentorEmail).toBe("quiet-mentor@example.edu");

    // No actor check (#379): staff naming their own address are emailed
    // like anyone else, with the same skip.
    await updateProjectMentorshipAs(
      admin,
      { id, mentorEmail: "admin-mentor-skip@x.edu", mentorNeed: "unspecified" },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("admin-mentor-skip@x.edu");
  });

  it("emails the address when it is named, and not when only the flags change", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser("admin-mentor-mail@x.edu", "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await updateProjectMentorshipAs(
      admin,
      {
        id,
        mentorEmail: "Mentor@Example.edu",
        mentorNeed: "unspecified",
      },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("mentor@example.edu");
    expect(send.mock.calls[0]?.[1].subject).toBe(
      "You were named as a mentor: P"
    );

    send.mockClear();
    await updateProjectMentorshipAs(
      admin,
      {
        id,
        mentorEmail: "mentor@example.edu",
        mentorNeed: "seeking",
      },
      { send }
    );
    await updateProjectMentorshipAs(
      admin,
      { id, mentorEmail: "", mentorNeed: "seeking" },
      { send }
    );
    expect(send).not.toHaveBeenCalled();
  });
});

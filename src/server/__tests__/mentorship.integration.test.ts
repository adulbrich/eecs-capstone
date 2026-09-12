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
  updateProjectAs,
  updateProjectMentorshipAs,
  updateProjectProposerAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  getProjectMentorshipAs,
  getProposerForEditAs,
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
      seekingMentor: projects.seekingMentor,
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
        seekingMentor: true,
      })
    ).rejects.toThrow("Forbidden");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      seekingMentor: false,
      studentProposed: false,
    });
  });

  it("writes both columns and one edit log row, and an unchanged save writes none", async () => {
    const admin = await makeUser(`ma-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    const first = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "  Mentor@X.com ",
      seekingMentor: true,
    });
    expect(first.updated).toBe(true);
    // Trimmed and lowercased, since #249 chose to normalize on write.
    expect(await columns(id)).toEqual({
      mentorEmail: "mentor@x.com",
      seekingMentor: true,
      studentProposed: false,
    });

    // A save that differs only in case now finds no changed field, so it
    // writes no row and no edit log entry. That is the cost of normalizing
    // on write, recorded in QUIRKS rather than worked around here.
    const again = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "MENTOR@x.com",
      seekingMentor: true,
    });
    expect(again.updated).toBe(false);

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].editorId).toBe(admin.id);
    expect(log[0].changedFields).toEqual(["seekingMentor", "mentorEmail"]);
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
      seekingMentor: true,
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
    expect(log[1].changedFields).toEqual(["seekingMentor"]);
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
      seekingMentor: false,
    });
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      seekingMentor: false,
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
      seekingMentor: true,
      studentProposed: true,
    };
    await updateProjectAs(admin, smuggled);
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      seekingMentor: false,
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
      seekingMentor: true,
      mentorEmail: "",
      badge: true,
    },
    {
      studentProposed: true,
      seekingMentor: true,
      mentorEmail: "m@x.com",
      badge: false,
    },
    {
      studentProposed: true,
      seekingMentor: false,
      mentorEmail: "",
      badge: false,
    },
    {
      studentProposed: false,
      seekingMentor: true,
      mentorEmail: "",
      badge: true,
    },
    {
      studentProposed: false,
      seekingMentor: true,
      mentorEmail: "m@x.com",
      badge: false,
    },
    {
      studentProposed: false,
      seekingMentor: false,
      mentorEmail: "",
      badge: false,
    },
  ])(
    "student $studentProposed, seeking $seekingMentor, address '$mentorEmail' shows the seeking badge: $badge",
    async ({ studentProposed, seekingMentor, mentorEmail, badge }) => {
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
        seekingMentor,
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
    expect("mentorName" in (project ?? {})).toBe(false);
  });

  it("shows the public nothing about a recorded mentor, before or after they sign up", async () => {
    const { admin, id } = await publishedProject();
    const stamp = Date.now();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: `Mentor-${stamp}@X.com`,
      seekingMentor: true,
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
      seekingMentor: true,
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
      seekingMentor: false,
    });
    const { project } = await getProjectAs(owner, { id });
    expect(project).not.toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);
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
      seekingMentor: false,
    });

    // Typed with capitals, stored without them, and the name still resolves:
    // mentorNameSql matches the normalized column against user.email, which
    // Better Auth lowercases on every path that creates an account (#249).
    // The staff read carries the stored flag even while an address is on
    // file; only the public badge is guarded by the address.
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: owner.email.toUpperCase(),
      seekingMentor: true,
    });
    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: owner.email,
      mentorName: owner.name,
      seekingMentor: true,
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
        seekingMentor: false,
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
        seekingMentor: true,
      },
      { send }
    );
    await updateProjectMentorshipAs(
      admin,
      { id, mentorEmail: "", seekingMentor: true },
      { send }
    );
    expect(send).not.toHaveBeenCalled();
  });
});

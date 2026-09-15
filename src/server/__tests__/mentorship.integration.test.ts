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
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, id));
  return row;
}

/** No key about the mentor, whatever its name: the pin #402 leaves on every public read. */
function expectNothingAboutTheMentor(payload: object) {
  for (const key of Object.keys(payload)) {
    expect(key.toLowerCase()).not.toContain("mentor");
  }
}

describe("updateProjectMentorshipAs", () => {
  it("refuses a non-staff viewer, the proposer included", async () => {
    const owner = await makeUser(`mo-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await expect(
      updateProjectMentorshipAs(owner, { id, mentorEmail: "m@x.com" })
    ).rejects.toThrow("Forbidden");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });

  it("writes the address and one edit log row naming it, and an unchanged save writes none", async () => {
    const admin = await makeUser(`ma-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    const first = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "  Mentor@X.com ",
    });
    expect(first.updated).toBe(true);
    // Trimmed and lowercased, since #249 chose to normalize on write.
    expect(await columns(id)).toEqual({
      mentorEmail: "mentor@x.com",
      studentProposed: false,
    });

    // A save that differs only in case now finds no changed field, so it
    // writes no row and no edit log entry. That is the cost of normalizing
    // on write, recorded in QUIRKS rather than worked around here.
    const again = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "MENTOR@x.com",
    });
    expect(again.updated).toBe(false);

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].editorId).toBe(admin.id);
    // The address alone since #402: no state beside it for the log to name.
    expect(log[0].changedFields).toEqual(["mentorEmail"]);
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
    await updateProjectMentorshipAs(admin, { id, mentorEmail: "m@x.com" });
    expect((await columns(id)).studentProposed).toBe(true);
    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    // The first row may also carry the address the link resolved to; the
    // mark is what this asserts, and the mentorship row never carries it.
    expect(log).toHaveLength(2);
    expect(log[0].changedFields).toContain("studentProposed");
    expect(log[1].changedFields).toEqual(["mentorEmail"]);
    expect(
      (await getProposerForEditAs(admin, { projectId: id })).studentProposed
    ).toBe(true);
  });

  it("clears the address when given an empty string", async () => {
    const admin = await makeUser(`mc-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    await updateProjectMentorshipAs(admin, { id, mentorEmail: "m@x.com" });
    await updateProjectMentorshipAs(admin, { id, mentorEmail: "" });
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
      studentProposed: true,
    };
    await updateProjectAs(admin, smuggled);
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });
});

describe("the public payload", () => {
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

  // One row per combination staff can record since #402: the mark, and an
  // address or none. Whatever the address, the public read says nothing
  // about it, and there is no state beside it that a flag could derive.
  it.each([
    { studentProposed: true, mentorEmail: "" },
    { studentProposed: true, mentorEmail: "m@x.com" },
    { studentProposed: false, mentorEmail: "" },
    { studentProposed: false, mentorEmail: "m@x.com" },
  ])(
    "student $studentProposed, address '$mentorEmail': the mark and nothing about the mentor",
    async ({ studentProposed, mentorEmail }) => {
      const { admin, id } = await publishedProject();
      // Two writers since #336: the mark travels with the proposer link.
      await updateProjectProposerAs(admin, {
        id,
        proposerEmail: admin.email,
        studentProposed,
      });
      await updateProjectMentorshipAs(admin, { id, mentorEmail });
      const { project } = await getProjectAs(null, { id });
      expect(project?.studentProposed).toBe(studentProposed);
      expectNothingAboutTheMentor(project ?? {});
    }
  );

  it("starts with nothing set", async () => {
    const { id } = await publishedProject();
    const { project } = await getProjectAs(null, { id });
    expect(project?.studentProposed).toBe(false);
    expectNothingAboutTheMentor(project ?? {});
  });

  it("shows the public nothing about a recorded mentor, before or after they sign up", async () => {
    const { admin, id } = await publishedProject();
    const stamp = Date.now();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: `Mentor-${stamp}@X.com`,
    });
    let { project } = await getProjectAs(null, { id });
    expectNothingAboutTheMentor(project ?? {});

    // The name resolves case-insensitively once the account exists, and it
    // resolves for staff only (#336): the public read still says nothing.
    const mentor = await makeUser(`mentor-${stamp}@x.com`, "user");
    ({ project } = await getProjectAs(null, { id }));
    expectNothingAboutTheMentor(project ?? {});
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
    expect("mentorNeed" in staffRow).toBe(false);
  });

  it("keeps the mentor out of the shared listing projection", async () => {
    const { admin, id } = await publishedProject();
    await updateProjectMentorshipAs(admin, { id, mentorEmail: "m@x.com" });
    const [row] = await db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(eq(projects.id, id));
    expect(row.studentProposed).toBe(false);
    expectNothingAboutTheMentor(row);
  });

  it("never carries the address for the proposer either", async () => {
    const owner = await makeUser(`mown-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`madm-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "private@x.com",
    });
    const { project } = await getProjectAs(owner, { id });
    expect(project).not.toBeNull();
    expectNothingAboutTheMentor(project ?? {});
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
    });

    // Typed with capitals, stored without them, and the name still resolves:
    // mentorNameSql matches the normalized column against user.email, which
    // Better Auth lowercases on every path that creates an account (#249).
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: owner.email.toUpperCase(),
    });
    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: owner.email,
      mentorName: owner.name,
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
      { id, mentorEmail: "admin-mentor-skip@x.edu" },
      { send }
    );
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe("admin-mentor-skip@x.edu");
  });

  it("emails the address when it is named, and not when it is kept or cleared", async () => {
    process.env.BETTER_AUTH_URL = "https://app";
    const admin = await makeUser("admin-mentor-mail@x.edu", "admin");
    const { id } = await createProjectAs(admin, baseProject());
    const send = vi.fn().mockResolvedValue(undefined);

    await updateProjectMentorshipAs(
      admin,
      {
        id,
        mentorEmail: "Mentor@Example.edu",
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
      { id, mentorEmail: "mentor@example.edu" },
      { send }
    );
    await updateProjectMentorshipAs(admin, { id, mentorEmail: "" }, { send });
    expect(send).not.toHaveBeenCalled();
  });
});

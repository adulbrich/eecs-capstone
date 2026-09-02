import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projectEditLog, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { projectSummarySelect } from "#/server/_internal/project-summary";
import {
  createProjectAs,
  forceTransitionAs,
  updateProjectAs,
  updateProjectMentorshipAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  getProjectMentorshipAs,
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

describe("updateProjectMentorshipAs", () => {
  it("refuses a non-staff viewer, the proposer included", async () => {
    const owner = await makeUser(`mo-${Date.now()}@x.com`, "user");
    const { id } = await createProjectAs(owner, baseProject());
    await expect(
      updateProjectMentorshipAs(owner, {
        id,
        mentorEmail: "m@x.com",
        studentProposed: true,
      })
    ).rejects.toThrow("Forbidden");
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });

  it("writes both columns and one edit log row, and an unchanged save writes none", async () => {
    const admin = await makeUser(`ma-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());

    const first = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "  Mentor@X.com ",
      studentProposed: true,
    });
    expect(first.updated).toBe(true);
    // Trimmed, and stored as typed: the match is case-insensitive at read
    // time, so lowercasing here would only hide what staff entered.
    expect(await columns(id)).toEqual({
      mentorEmail: "Mentor@X.com",
      studentProposed: true,
    });

    const again = await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "Mentor@X.com",
      studentProposed: true,
    });
    expect(again.updated).toBe(false);

    const log = await db
      .select()
      .from(projectEditLog)
      .where(eq(projectEditLog.projectId, id));
    expect(log).toHaveLength(1);
    expect(log[0].editorId).toBe(admin.id);
    expect(log[0].changedFields).toEqual(["studentProposed", "mentorEmail"]);
  });

  it("clears the address when given an empty string", async () => {
    const admin = await makeUser(`mc-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(admin, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "m@x.com",
      studentProposed: false,
    });
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      studentProposed: false,
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
      studentProposed: true,
    };
    await updateProjectAs(admin, smuggled);
    expect(await columns(id)).toEqual({
      mentorEmail: null,
      studentProposed: false,
    });
  });
});

describe("the three public states", () => {
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

  it("shows seeking only for a student-proposed project with no address", async () => {
    const { admin, id } = await publishedProject();
    let { project } = await getProjectAs(null, { id });
    expect(project?.studentProposed).toBe(false);
    expect(project?.seekingMentor).toBe(false);
    expect(project?.mentorName).toBeNull();

    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      studentProposed: true,
    });
    ({ project } = await getProjectAs(null, { id }));
    expect(project?.studentProposed).toBe(true);
    expect(project?.seekingMentor).toBe(true);
    expect(project?.mentorName).toBeNull();
  });

  it("shows nothing for an address with no account, then the name once it exists, case-insensitively", async () => {
    const { admin, id } = await publishedProject();
    const stamp = Date.now();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: `Mentor-${stamp}@X.com`,
      studentProposed: true,
    });
    let { project } = await getProjectAs(null, { id });
    expect(project?.seekingMentor).toBe(false);
    expect(project?.mentorName).toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);

    const mentor = await makeUser(`mentor-${stamp}@x.com`, "user");
    ({ project } = await getProjectAs(null, { id }));
    expect(project?.mentorName).toBe(mentor.name);
    expect(project?.seekingMentor).toBe(false);
  });

  it("reaches the shared listing projection", async () => {
    const { admin, id } = await publishedProject();
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "",
      studentProposed: true,
    });
    const [row] = await db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(eq(projects.id, id));
    expect(row.studentProposed).toBe(true);
    expect(row.seekingMentor).toBe(true);
    expect(row.mentorName).toBeNull();
    expect("mentorEmail" in row).toBe(false);
  });

  it("never carries the address for the proposer either", async () => {
    const owner = await makeUser(`mown-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`madm-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());
    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: "private@x.com",
      studentProposed: false,
    });
    const { project } = await getProjectAs(owner, { id });
    expect(project).not.toBeNull();
    expect("mentorEmail" in (project ?? {})).toBe(false);
  });
});

describe("getProjectMentorshipAs", () => {
  it("returns the raw address and the resolved name to staff, and Forbidden to anyone else", async () => {
    const owner = await makeUser(`go-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`ga-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: "",
      mentorName: null,
      studentProposed: false,
    });

    await updateProjectMentorshipAs(admin, {
      id,
      mentorEmail: owner.email.toUpperCase(),
      studentProposed: true,
    });
    expect(await getProjectMentorshipAs(admin, { projectId: id })).toEqual({
      mentorEmail: owner.email.toUpperCase(),
      mentorName: owner.name,
      studentProposed: true,
    });

    await expect(
      getProjectMentorshipAs(owner, { projectId: id })
    ).rejects.toThrow("Forbidden");
    await expect(
      getProjectMentorshipAs(null, { projectId: id })
    ).rejects.toThrow("Forbidden");
  });
});

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projectEditLog, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  forceTransitionAs,
  updateProjectAs,
  updateProjectMentorshipAs,
  updateProjectProgramsAs,
  updateProjectProposerAs,
} from "#/server/_internal/projects";

/**
 * `projects.updated_at` orders the public listing under "Recently updated"
 * (#475), so it moves only when something a visitor can see changed (#502).
 * Asserted against the column, not through the listing.
 *
 * Every test pins the column to a fixed old instant before the write under
 * test. The row's first value comes from Postgres's `defaultNow()` and a
 * writer's from the host's `new Date()`, so comparing the two directly would
 * be at the mercy of clock skew between the container and the host.
 */
const PINNED = new Date("2020-01-01T00:00:00.000Z");

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.createUser({ body: { email, name: `Name of ${email}` } });
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
    notes: null,
    teamsSupported: 1,
  };
}

async function pinnedProject() {
  const admin = await makeUser(
    `ua-${Date.now()}-${Math.random()}@x.com`,
    "admin"
  );
  const { id } = await createProjectAs(admin, baseProject());
  await db
    .update(projects)
    .set({ updatedAt: PINNED })
    .where(eq(projects.id, id));
  return { admin, id };
}

async function updatedAt(id: string) {
  const [row] = await db
    .select({ updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.id, id));
  return row.updatedAt;
}

async function editLog(id: string) {
  return await db
    .select({ changedFields: projectEditLog.changedFields })
    .from(projectEditLog)
    .where(eq(projectEditLog.projectId, id));
}

describe("a mentorship save never moves updated_at", () => {
  // The mentor stays on the staff read (#402), so no visitor can see this
  // change, and the edit log row stays the record that it happened.
  it("on assigning, changing or clearing a mentor, with a log row each", async () => {
    const { admin, id } = await pinnedProject();

    for (const mentorEmail of ["m1@x.com", "m2@x.com", ""]) {
      const { updated } = await updateProjectMentorshipAs(
        admin,
        { id, mentorEmail },
        { sendEmail: false }
      );
      expect(updated).toBe(true);
      expect(await updatedAt(id)).toEqual(PINNED);
    }

    expect((await editLog(id)).map((row) => row.changedFields)).toEqual([
      ["mentorEmail"],
      ["mentorEmail"],
      ["mentorEmail"],
    ]);
  });
});

describe("a proposer save moves updated_at only with studentProposed", () => {
  it("leaves it when only the linked address changes", async () => {
    const { admin, id } = await pinnedProject();
    const other = await makeUser(`up-${Date.now()}@x.com`, "user");

    const { updated } = await updateProjectProposerAs(
      admin,
      { id, proposerEmail: other.email, studentProposed: false },
      { sendEmail: false }
    );

    expect(updated).toBe(true);
    expect(await updatedAt(id)).toEqual(PINNED);
    const log = await editLog(id);
    expect(log).toHaveLength(1);
    expect(log[0].changedFields).not.toContain("studentProposed");
  });

  it("moves it when the student-proposed mark changes", async () => {
    const { admin, id } = await pinnedProject();

    await updateProjectProposerAs(
      admin,
      { id, proposerEmail: admin.email, studentProposed: true },
      { sendEmail: false }
    );

    expect((await updatedAt(id)).getTime()).toBeGreaterThan(PINNED.getTime());
    const log = await editLog(id);
    expect(log).toHaveLength(1);
    expect(log[0].changedFields).toContain("studentProposed");
  });

  it("moves it when the mark changes alongside a relink", async () => {
    const { admin, id } = await pinnedProject();
    const other = await makeUser(`ur-${Date.now()}@x.com`, "user");

    await updateProjectProposerAs(
      admin,
      { id, proposerEmail: other.email, studentProposed: true },
      { sendEmail: false }
    );

    expect((await updatedAt(id)).getTime()).toBeGreaterThan(PINNED.getTime());
  });
});

// The three writers whose change reaches `projectDetailView`. Each keeps its
// bump, and a test each so a later cleanup of the two above cannot take these
// with it.
describe("the writers a visitor can see still move updated_at", () => {
  it("updateProjectAs", async () => {
    const { admin, id } = await pinnedProject();
    await updateProjectAs(admin, { ...baseProject(), id, title: "Renamed" });
    expect((await updatedAt(id)).getTime()).toBeGreaterThan(PINNED.getTime());
  });

  it("a status transition", async () => {
    const { admin, id } = await pinnedProject();
    await forceTransitionAs(admin, id, "submitted", undefined, {
      sendEmail: false,
    });
    expect((await updatedAt(id)).getTime()).toBeGreaterThan(PINNED.getTime());
  });

  it("updateProjectProgramsAs", async () => {
    const { admin, id } = await pinnedProject();
    const [program] = await db
      .insert(programs)
      .values({ courseId: `CS ${Date.now()}`, courseName: "Capstone" })
      .returning();
    await updateProjectProgramsAs(admin, {
      id,
      programIds: [program.id],
      acceptingApplicants: true,
      teamsSupported: 1,
    });
    expect((await updatedAt(id)).getTime()).toBeGreaterThan(PINNED.getTime());
  });
});

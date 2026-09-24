import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projectPrograms, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import { getSimilarProjectsAs } from "#/server/_internal/projects-queries";

/**
 * A vector at a known angle from axis 0, so cosine distance from * `vectorAt(0)` grows with `step` and the expected order is written down
 * rather than recomputed.
 */
function vectorAt(step: number) {
  return Array.from({ length: 1024 }, (_, i) => {
    if (i === 0) {
      return 10 - step;
    }
    return i === 1 ? step : 0;
  });
}

async function makeAdmin(email: string) {
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeProgram(courseId: string) {
  const [row] = await db
    .insert(programs)
    .values({ courseId, courseName: "Capstone" })
    .returning({ id: programs.id });
  return row.id;
}

type Admin = Awaited<ReturnType<typeof makeAdmin>>;

async function makeProject(
  admin: Admin,
  title: string,
  options: {
    vector?: number[] | null;
    programIds?: string[];
    status?: "draft" | "published" | "archived";
    acceptingApplicants?: boolean;
    description?: string | null;
  } = {}
) {
  const {
    vector = null,
    programIds = [],
    status = "published",
    acceptingApplicants = true,
    description = null,
  } = options;
  const { id } = await createProjectAs(admin, {
    title,
    description,
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
  });
  if (status !== "draft") {
    await performTransitionAs(admin, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");
  }
  if (status === "archived") {
    await performTransitionAs(admin, id, "archived");
  }
  await db
    .update(projects)
    .set({
      acceptingApplicants,
      embedding: vector,
      embeddingSourceHash: vector ? "test" : null,
    })
    .where(eq(projects.id, id));
  for (const programId of programIds) {
    await db.insert(projectPrograms).values({ projectId: id, programId });
  }
  return id;
}

describe("getSimilarProjectsAs", () => {
  it("lists published projects in a shared program, nearest first, without the viewed one", async () => {
    const admin = await makeAdmin(`s-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const viewed = await makeProject(admin, "Viewed", {
      vector: vectorAt(0),
      programIds: [program],
    });
    await makeProject(admin, "Far", {
      vector: vectorAt(8),
      programIds: [program],
    });
    await makeProject(admin, "Near", {
      vector: vectorAt(1),
      programIds: [program],
    });
    await makeProject(admin, "Middle", {
      vector: vectorAt(4),
      programIds: [program],
    });

    const rows = await getSimilarProjectsAs(null, { projectId: viewed });

    expect(rows.map((r) => r.title)).toEqual(["Near", "Middle", "Far"]);
  });

  it("leaves out a project that is closed, not published, deleted, unembedded or in another program", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const other = await makeProgram(`EE${Date.now()}`);
    const inProgram = { vector: vectorAt(1), programIds: [program] };
    const viewed = await makeProject(admin, "Viewed", {
      vector: vectorAt(0),
      programIds: [program],
    });
    await makeProject(admin, "Eligible", inProgram);
    await makeProject(admin, "Closed", {
      ...inProgram,
      acceptingApplicants: false,
    });
    await makeProject(admin, "Archived", { ...inProgram, status: "archived" });
    await makeProject(admin, "Draft", { ...inProgram, status: "draft" });
    const deleted = await makeProject(admin, "Deleted", inProgram);
    await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, deleted));
    await makeProject(admin, "Unembedded", { ...inProgram, vector: null });
    await makeProject(admin, "Other program", {
      ...inProgram,
      programIds: [other],
    });
    await makeProject(admin, "No program", { ...inProgram, programIds: [] });

    const rows = await getSimilarProjectsAs(null, { projectId: viewed });

    expect(rows.map((r) => r.title)).toEqual(["Eligible"]);
  });

  it("stops at the five nearest", async () => {
    const admin = await makeAdmin(`l-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const viewed = await makeProject(admin, "Viewed", {
      vector: vectorAt(0),
      programIds: [program],
    });
    for (const step of [7, 1, 6, 2, 5, 3, 4]) {
      await makeProject(admin, `Step ${step}`, {
        vector: vectorAt(step),
        programIds: [program],
      });
    }

    const rows = await getSimilarProjectsAs(null, { projectId: viewed });

    expect(rows.map((r) => r.title)).toEqual([
      "Step 1",
      "Step 2",
      "Step 3",
      "Step 4",
      "Step 5",
    ]);
  });

  it("is empty when the viewed project has no embedding", async () => {
    const admin = await makeAdmin(`n-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const viewed = await makeProject(admin, "Viewed", {
      vector: null,
      programIds: [program],
    });
    await makeProject(admin, "Candidate", {
      vector: vectorAt(1),
      programIds: [program],
    });

    expect(await getSimilarProjectsAs(null, { projectId: viewed })).toEqual([]);
  });

  it("is empty for a viewer who cannot see the viewed project, and full for staff", async () => {
    const admin = await makeAdmin(`v-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const viewed = await makeProject(admin, "Viewed", {
      vector: vectorAt(0),
      programIds: [program],
    });
    await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, viewed));
    await makeProject(admin, "Candidate", {
      vector: vectorAt(1),
      programIds: [program],
    });

    expect(await getSimilarProjectsAs(null, { projectId: viewed })).toEqual([]);
    const staffRows = await getSimilarProjectsAs(admin, { projectId: viewed });
    expect(staffRows.map((r) => r.title)).toEqual(["Candidate"]);
  });

  it("returns an id, a title and a plain excerpt, and nothing about the vectors", async () => {
    const admin = await makeAdmin(`k-${Date.now()}@x.com`);
    const program = await makeProgram(`CS${Date.now()}`);
    const viewed = await makeProject(admin, "Viewed", {
      vector: vectorAt(0),
      programIds: [program],
    });
    const long = `## Goal\n\nBuild a **drone** that maps [the quad](https://example.com). ${"More words follow here. ".repeat(20)}`;
    const candidate = await makeProject(admin, "Candidate", {
      vector: vectorAt(1),
      programIds: [program],
      description: long,
    });
    await makeProject(admin, "Blank", {
      vector: vectorAt(2),
      programIds: [program],
      description: null,
    });

    const [row, blank] = await getSimilarProjectsAs(null, {
      projectId: viewed,
    });

    expect(Object.keys(row).sort()).toEqual(["excerpt", "id", "title"]);
    expect(row.id).toBe(candidate);
    expect(
      row.excerpt.startsWith("Goal Build a drone that maps the quad. ")
    ).toBe(true);
    expect(row.excerpt.length).toBeLessThanOrEqual(160);
    expect(row.excerpt.endsWith("...")).toBe(true);
    expect(blank.excerpt).toBe("");
  });
});

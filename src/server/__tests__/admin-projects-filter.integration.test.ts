import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  listAdminProjectsAs,
} from "#/server/_internal/projects-queries";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

async function makeAdmin(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
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
    .returning();
  return row.id;
}

function baseProject(title: string, programId: string | null) {
  return {
    title,
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
    programId,
    notes: null,
  };
}

/**
 * The admin filter shape, with the fields each test does not care about
 * defaulted. Keeps adding a filter from rewriting every call site.
 */
function filter(
  overrides: Partial<Parameters<typeof listAdminProjectsAs>[1]> = {}
): Parameters<typeof listAdminProjectsAs>[1] {
  return {
    status: "all",
    includeSoftDeleted: false,
    program: null,
    proposer: null,
    q: "",
    ...overrides,
  };
}

describe("admin projects program filter", () => {
  it("returns only projects in the selected program", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");
    const ece441 = await makeProgram("ECE 441");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("In ECE 441", ece441));

    const { rows } = await listAdminProjectsAs(
      admin,
      filter({ program: cs461 })
    );

    expect(rows.map((r) => r.title)).toEqual(["In CS 461"]);
  });

  it("includes projects with no program when no program is selected", async () => {
    const admin = await makeAdmin(`b-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("No program", null));

    const { rows } = await listAdminProjectsAs(admin, filter());

    expect(rows.map((r) => r.title).sort()).toEqual([
      "In CS 461",
      "No program",
    ]);
  });

  it("composes the program filter with the status filter", async () => {
    const admin = await makeAdmin(`c-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");
    const ece441 = await makeProgram("ECE 441");

    const draft = await createProjectAs(admin, baseProject("Draft", cs461));
    const live = await createProjectAs(admin, baseProject("Live", cs461));
    await performTransitionAs(admin, live.id, "submitted");
    await performTransitionAs(admin, live.id, "approved");
    await performTransitionAs(admin, live.id, "published");

    const otherProgram = await createProjectAs(
      admin,
      baseProject("Live elsewhere", ece441)
    );
    await performTransitionAs(admin, otherProgram.id, "submitted");
    await performTransitionAs(admin, otherProgram.id, "approved");
    await performTransitionAs(admin, otherProgram.id, "published");

    const { rows } = await listAdminProjectsAs(
      admin,
      filter({ status: "published", program: cs461 })
    );

    expect(rows.map((r) => r.title)).toEqual(["Live"]);
    expect(rows.map((r) => r.id)).not.toContain(draft.id);
    expect(rows.map((r) => r.id)).not.toContain(otherProgram.id);
  });

  it("composes the program filter with soft-delete visibility", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    const deleted = await createProjectAs(
      admin,
      baseProject("Soft-deleted", cs461)
    );
    await performTransitionAs(admin, deleted.id, "submitted");
    await softDeleteProjectAs(admin, deleted.id);

    const withoutDeleted = await listAdminProjectsAs(
      admin,
      filter({ program: cs461 })
    );
    expect(withoutDeleted.rows.map((r) => r.id)).not.toContain(deleted.id);

    const withDeleted = await listAdminProjectsAs(
      admin,
      filter({ includeSoftDeleted: true, program: cs461 })
    );
    expect(withDeleted.rows.map((r) => r.id)).toContain(deleted.id);
  });

  it("still refuses non-staff viewers", async () => {
    await auth.api.signUpEmail({
      body: { email: "plain@x.com", password: "Password1!", name: "plain" },
    });
    const [u] = await db
      .select()
      .from(user)
      .where(eq(user.email, "plain@x.com"));

    await expect(
      listAdminProjectsAs({ id: u.id, role: u.role }, filter())
    ).rejects.toThrow("Forbidden");
  });
});

describe("getProjectAs", () => {
  it("never returns the embedding vector, even to a staff viewer after the project has been embedded", async () => {
    const admin = await makeAdmin(`staff-getproject-${Date.now()}@x.com`);
    const { id } = await createProjectAs(
      admin,
      baseProject("Embedded project", null)
    );
    await performTransitionAs(admin, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    await db
      .update(projects)
      .set({
        embedding: VECTOR,
        embeddingSourceHash: "test-hash",
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    const { project } = await getProjectAs(admin, { id });
    expect(project).not.toBeNull();
    expect(project?.embedding).toBeFalsy();
    expect(project?.embeddingSourceHash).toBeFalsy();
    expect(project?.embeddingUpdatedAt).toBeFalsy();
  });
});

async function makeProposer(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("admin projects search", () => {
  it("matches on title and on body text", async () => {
    const admin = await makeAdmin(`s-${Date.now()}@x.com`);
    await createProjectAs(admin, {
      ...baseProject("Warehouse Robot Fleet", null),
      description: "Coordinates autonomous forklifts in a distribution centre.",
    });
    await createProjectAs(admin, baseProject("Wildlife Camera Trap", null));

    const byTitle = await listAdminProjectsAs(
      admin,
      filter({ q: "warehouse" })
    );
    expect(byTitle.rows.map((r) => r.title)).toEqual(["Warehouse Robot Fleet"]);

    const byBody = await listAdminProjectsAs(admin, filter({ q: "forklifts" }));
    expect(byBody.rows.map((r) => r.title)).toEqual(["Warehouse Robot Fleet"]);
  });

  it("matches a partial word, which the tsvector alone would not", async () => {
    const admin = await makeAdmin(`s2-${Date.now()}@x.com`);
    await createProjectAs(admin, baseProject("Telemetry Platform", null));

    const { rows } = await listAdminProjectsAs(admin, filter({ q: "eleme" }));
    expect(rows.map((r) => r.title)).toEqual(["Telemetry Platform"]);
  });

  it("composes search with the status filter", async () => {
    const admin = await makeAdmin(`s3-${Date.now()}@x.com`);
    const live = await createProjectAs(
      admin,
      baseProject("Sensor Draft", null)
    );
    await createProjectAs(admin, baseProject("Sensor Other", null));
    await performTransitionAs(admin, live.id, "submitted");

    const { rows } = await listAdminProjectsAs(
      admin,
      filter({ q: "sensor", status: "submitted" })
    );
    expect(rows.map((r) => r.title)).toEqual(["Sensor Draft"]);
  });
});

describe("admin projects proposer filter", () => {
  it("returns only the selected proposer's projects", async () => {
    const admin = await makeAdmin(`p-a-${Date.now()}@x.com`);
    const alice = await makeProposer(`p-alice-${Date.now()}@x.com`);
    const bob = await makeProposer(`p-bob-${Date.now()}@x.com`);
    await createProjectAs(alice, baseProject("Alice project", null));
    await createProjectAs(bob, baseProject("Bob project", null));

    const { rows } = await listAdminProjectsAs(
      admin,
      filter({ proposer: alice.id })
    );
    expect(rows.map((r) => r.title)).toEqual(["Alice project"]);
  });

  it("offers every proposer in the current status/program/deleted scope", async () => {
    const admin = await makeAdmin(`p2-a-${Date.now()}@x.com`);
    const alice = await makeProposer(`p2-alice-${Date.now()}@x.com`);
    const bob = await makeProposer(`p2-bob-${Date.now()}@x.com`);
    const alicePublished = await createProjectAs(
      alice,
      baseProject("Alice published", null)
    );
    await performTransitionAs(alice, alicePublished.id, "submitted");
    await performTransitionAs(admin, alicePublished.id, "approved");
    await performTransitionAs(admin, alicePublished.id, "published");
    await createProjectAs(bob, baseProject("Bob draft", null));

    const all = await listAdminProjectsAs(admin, filter());
    expect(all.proposers.map((p) => p.id).sort()).toEqual(
      [alice.id, bob.id].sort()
    );

    // Bob has nothing published, so he drops out of the options when the
    // status filter narrows. This is the behaviour the dropdown depends on.
    const published = await listAdminProjectsAs(
      admin,
      filter({ status: "published" })
    );
    expect(published.proposers.map((p) => p.id)).toEqual([alice.id]);
  });

  it("does not narrow the proposer options by the search text or by the chosen proposer", async () => {
    const admin = await makeAdmin(`p3-a-${Date.now()}@x.com`);
    const alice = await makeProposer(`p3-alice-${Date.now()}@x.com`);
    const bob = await makeProposer(`p3-bob-${Date.now()}@x.com`);
    await createProjectAs(alice, baseProject("Quantum compiler", null));
    await createProjectAs(bob, baseProject("Garden sensors", null));

    // Searching for one project must not empty the dropdown of the other's
    // proposer, or picking from it becomes impossible.
    const searched = await listAdminProjectsAs(admin, filter({ q: "quantum" }));
    expect(searched.rows).toHaveLength(1);
    expect(searched.proposers.map((p) => p.id).sort()).toEqual(
      [alice.id, bob.id].sort()
    );

    // Likewise, selecting a proposer must not reduce the options to just them.
    const selected = await listAdminProjectsAs(
      admin,
      filter({ proposer: alice.id })
    );
    expect(selected.rows).toHaveLength(1);
    expect(selected.proposers.map((p) => p.id).sort()).toEqual(
      [alice.id, bob.id].sort()
    );
  });
});

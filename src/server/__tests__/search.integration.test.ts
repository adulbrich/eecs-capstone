import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
  updateProjectProgramsAs,
  updateProjectProposerAs,
} from "#/server/_internal/projects";
import { searchProjectsImpl } from "#/server/_internal/search";

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

function baseProject(title: string, description: string | null = null) {
  return {
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
  };
}

async function publish(
  admin: { id: string; role: string | null },
  title: string,
  body: Partial<Parameters<typeof createProjectAs>[1]> = {}
) {
  const { id } = await createProjectAs(admin, {
    ...baseProject(title),
    ...body,
  });
  await performTransitionAs(admin, id, "submitted");
  await performTransitionAs(admin, id, "approved");
  await performTransitionAs(admin, id, "published");
  return id;
}

// Every input the impl requires, so a new filter lands here once rather than
// in every call below. `recommended-sort.integration.test.ts` has its own.
const SEARCH_DEFAULTS = {
  query: "",
  categoryIds: [] as string[],
  programId: null,
  archivedOnly: false,
  acceptingOnly: false,
  studentProposedOnly: false,
  requiresNdaOnly: false,
  page: 1,
  pageSize: 20,
  sort: "relevance" as const,
};

describe("searchProjects", () => {
  it("ranks title hit above description hit for the same query", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const titleId = await publish(admin, "React UI Library");
    const descId = await publish(admin, "Random thing", {
      description: "uses react under the hood",
    });

    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "react",
    });
    expect(rows[0].id).toBe(titleId);
    const order = rows.map((r) => r.id);
    expect(order.indexOf(titleId)).toBeLessThan(order.indexOf(descId));
  });

  it("acceptingOnly hides projects whose team is full", async () => {
    const admin = await makeAdmin(`a-acc-${Date.now()}@x.com`);
    const openId = await publish(admin, "Open roster");
    const closedId = await publish(admin, "Closed roster", {
      acceptingApplicants: false,
    });
    const input = { ...SEARCH_DEFAULTS, pageSize: 50 };

    // Off by default: the catalog stays browsable and a closed project is
    // still worth reading about.
    const all = await searchProjectsImpl({ ...input, acceptingOnly: false });
    expect(all.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([openId, closedId])
    );
    expect(all.rows.find((r) => r.id === closedId)?.acceptingApplicants).toBe(
      false
    );

    const open = await searchProjectsImpl({ ...input, acceptingOnly: true });
    expect(open.rows.map((r) => r.id)).toContain(openId);
    expect(open.rows.map((r) => r.id)).not.toContain(closedId);
  });

  it("does not return non-published projects", async () => {
    const admin = await makeAdmin(`a2-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Draft project"));
    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
    });
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it("empty query falls back to publishedAt desc", async () => {
    const admin = await makeAdmin(`a3-${Date.now()}@x.com`);
    const first = await publish(admin, "First");
    const second = await publish(admin, "Second");
    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
    });
    const order = rows.map((r) => r.id);
    expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
  });

  it("whitespace-only query is treated as empty", async () => {
    const admin = await makeAdmin(`a4-${Date.now()}@x.com`);
    await publish(admin, "Anything");
    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "   ",
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns exactly the public field set", async () => {
    // Pinned so a private column cannot ride into the anonymous listing with
    // nothing failing. The list is projectDetailView's public fields minus the
    // three the listing has no use for (notes, isSponsored, deletedAt)
    // plus `updatedAt` and the correlated categories string. proposerEmail and
    // notes must never appear here.
    const admin = await makeAdmin(`k-${Date.now()}@x.com`);
    await publish(admin, "Key set");

    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
    });
    expect(Object.keys(rows[0]).sort()).toEqual([
      "acceptingApplicants",
      "categories",
      "contactEmail",
      "contactName",
      "description",
      "id",
      "imageUrl",
      "licenseRestrictions",
      "minQualifications",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "programs",
      "requiresNdaIp",
      "status",
      "studentProposed",
      "teamsSupported",
      "title",
      "updatedAt",
      "url",
    ]);
    // An array, never null: the chips map over it without a guard.
    expect(rows[0].categories).toEqual([]);
  });
});

// The public listing runs the same `runsInProgram` predicate the admin one
// does, so the filter stays single-valued and a project shared between two
// programs answers to both of them (#462).
describe("the program filter on the public listing", () => {
  it("returns a project that runs in the chosen program among others", async () => {
    const admin = await makeAdmin(`sp-${Date.now()}@x.com`);
    const [corvallis] = await db
      .insert(programs)
      .values({ courseId: `SP-A-${Date.now()}`, courseName: "Corvallis" })
      .returning();
    const [ecampus] = await db
      .insert(programs)
      .values({ courseId: `SP-B-${Date.now()}`, courseName: "Ecampus" })
      .returning();
    const shared = await publish(admin, "Shared across campuses");
    const onlyHere = await publish(admin, "Corvallis only");
    await updateProjectProgramsAs(admin, {
      id: shared,
      programIds: [corvallis.id, ecampus.id],
    });
    await updateProjectProgramsAs(admin, {
      id: onlyHere,
      programIds: [corvallis.id],
    });

    const inEcampus = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      programId: ecampus.id,
    });
    const inCorvallis = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      programId: corvallis.id,
    });

    expect(inEcampus.rows.map((r) => r.id)).toEqual([shared]);
    expect(inCorvallis.rows.map((r) => r.id).sort()).toEqual(
      [shared, onlyHere].sort()
    );
  });

  // The aggregate must not fan the row out, or a shared project would
  // appear twice in one page of results.
  it("lists a shared project once, carrying both programs", async () => {
    const admin = await makeAdmin(`sp2-${Date.now()}@x.com`);
    const [a] = await db
      .insert(programs)
      .values({ courseId: `SP-C-${Date.now()}`, courseName: "One" })
      .returning();
    const [b] = await db
      .insert(programs)
      .values({ courseId: `SP-D-${Date.now()}`, courseName: "Two" })
      .returning();
    const id = await publish(admin, "Listed once");
    await updateProjectProgramsAs(admin, { id, programIds: [a.id, b.id] });

    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      programId: a.id,
    });

    expect(rows.filter((r) => r.id === id)).toHaveLength(1);
    expect(rows[0].programs).toHaveLength(2);
  });
});

describe("the mark filters", () => {
  it("narrows to student-proposed projects on the raw flag", async () => {
    const admin = await makeAdmin(`sp-${Date.now()}@x.com`);
    const student = await publish(admin, "Student one");
    const partner = await publish(admin, "Partner one");
    await updateProjectProposerAs(admin, {
      id: student,
      proposerEmail: `sp-${Date.now()}@x.com`,
      studentProposed: true,
    });

    const all = await searchProjectsImpl({ ...SEARCH_DEFAULTS, pageSize: 50 });
    expect(all.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([student, partner])
    );
    const only = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      pageSize: 50,
      studentProposedOnly: true,
    });
    expect(only.rows.map((r) => r.id)).toEqual([student]);
    expect(only.total).toBe(1);
  });

  it("requiresNdaOnly narrows to projects that require an agreement, the same fact as the badge", async () => {
    const admin = await makeAdmin(`nda-${Date.now()}@x.com`);
    const plain = await publish(admin, "Plain");
    const agreement = await publish(admin, "Agreement");
    await db
      .update(projects)
      .set({ requiresNdaIp: true })
      .where(eq(projects.id, agreement));

    const only = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      pageSize: 50,
      requiresNdaOnly: true,
    });
    expect(only.rows.map((r) => r.id)).toEqual([agreement]);
    expect(only.rows[0]?.requiresNdaIp).toBe(true);
    expect(only.rows.map((r) => r.id)).not.toContain(plain);
  });

  it("sorts an archived project with no publish date by its creation date, not above everything", async () => {
    const admin = await makeAdmin(`arch-${Date.now()}@x.com`);
    // Two archived projects. The older one has no publishedAt, which is the
    // shape 302 of the 547 rows imported from the legacy portal carry: its
    // event log only starts 2022-08-03, so there is no publish date to
    // import and the column is left null rather than backfilled.
    const dateless = await publish(admin, "Older, no publish date");
    const dated = await publish(admin, "Newer, published");
    await performTransitionAs(admin, dateless, "archived");
    await performTransitionAs(admin, dated, "archived");
    await db
      .update(projects)
      .set({
        createdAt: new Date("2019-05-01T12:00:00.000Z"),
        publishedAt: null,
      })
      .where(eq(projects.id, dateless));
    await db
      .update(projects)
      .set({
        createdAt: new Date("2025-09-01T12:00:00.000Z"),
        publishedAt: new Date("2025-09-02T12:00:00.000Z"),
      })
      .where(eq(projects.id, dated));

    // Ordering on the bare column would put `dateless` first: Postgres `DESC`
    // is NULLS FIRST, so every dateless row floats above every dated one.
    // Ordering on coalesce(published_at, created_at) puts the 2025 project
    // first, which is what "newest" means to a reader.
    const newest = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      archivedOnly: true,
      pageSize: 50,
      sort: "newest",
    });
    expect(newest.rows.map((r) => r.id)).toEqual([dated, dateless]);

    // Same for the default relevance sort with no query text, which falls
    // through to the same date ordering.
    const relevance = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      archivedOnly: true,
      pageSize: 50,
    });
    expect(relevance.rows.map((r) => r.id)).toEqual([dated, dateless]);

    // And the dateless row is still reachable, not filtered out.
    expect(newest.total).toBe(2);
  });
});

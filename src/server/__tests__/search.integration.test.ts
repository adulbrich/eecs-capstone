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
    const closedId = await publish(admin, "Closed roster");
    // Staff only since #491, so it is set through the panel's writer rather
    // than through the project payload.
    await updateProjectProgramsAs(admin, {
      id: closedId,
      programIds: [],
      acceptingApplicants: false,
      teamsSupported: 1,
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

/**
 * The search box matches a contact's name or address, and a partial title,
 * beside the full-text match it already did (#476).
 *
 * The tsvector cannot answer any of these: Postgres classifies an address as
 * a single `email` token and emits it whole, so nothing inside it is
 * reachable, and a tsvector matches lexemes rather than substrings, so a
 * truncated word matches nothing either. The ILIKEs answer exactly that and
 * nothing the tsvector already covers.
 */
describe("searching the public listing by contact and by partial word", () => {
  it("matches a contact's full name, and their surname alone", async () => {
    const admin = await makeAdmin(`c1-${Date.now()}@x.com`);
    const id = await publish(admin, "Telemetry rig", {
      contactName: "Alice Smith",
      contactEmail: "alice.smith@oregonstate.edu",
    });

    for (const query of ["Alice Smith", "Smith"]) {
      const { rows } = await searchProjectsImpl({ ...SEARCH_DEFAULTS, query });
      expect(
        rows.map((r) => r.id),
        query
      ).toContain(id);
    }
  });

  it("matches the local part of a contact address, and the domain", async () => {
    const admin = await makeAdmin(`c2-${Date.now()}@x.com`);
    const id = await publish(admin, "Weather balloon", {
      contactName: "Alice Smith",
      contactEmail: "alice.smith@oregonstate.edu",
    });
    const elsewhere = await publish(admin, "Off campus", {
      contactName: "Bob Jones",
      contactEmail: "bob@example.com",
    });

    const local = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "alice.smith",
    });
    expect(local.rows.map((r) => r.id)).toContain(id);

    const domain = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "oregonstate.edu",
    });
    expect(domain.rows.map((r) => r.id)).toContain(id);
    expect(domain.rows.map((r) => r.id)).not.toContain(elsewhere);
  });

  it("matches a partial title", async () => {
    const admin = await makeAdmin(`c3-${Date.now()}@x.com`);
    const id = await publish(admin, "Robotics arm calibration");

    const { rows } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "roboti",
    });
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it("treats % and _ as characters rather than as wildcards", async () => {
    const admin = await makeAdmin(`c4-${Date.now()}@x.com`);
    const literal = await publish(admin, "Runs at 100% duty cycle");
    const other = await publish(admin, "Something else entirely");

    // Unescaped, `%` alone matches every row with a non-null title and
    // `100%` means "starts with 100"; both would put `other` here.
    for (const query of ["%", "100%"]) {
      const { rows, total } = await searchProjectsImpl({
        ...SEARCH_DEFAULTS,
        query,
      });
      expect(
        rows.map((r) => r.id),
        query
      ).not.toContain(other);
      // The count query runs the same conditions, so it cannot disagree.
      expect(total, query).toBe(rows.length);
    }

    // Both queries still find the project that really does carry a `%`,
    // which is what separates "escaped" from "stripped".
    for (const query of ["%", "100%"]) {
      const { rows } = await searchProjectsImpl({ ...SEARCH_DEFAULTS, query });
      expect(
        rows.map((r) => r.id),
        query
      ).toContain(literal);
    }

    // `_` is LIKE's single-character wildcard, so unescaped `d_ty` would
    // reach "duty".
    const underscore = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "d_ty",
    });
    expect(underscore.rows.map((r) => r.id)).not.toContain(literal);
  });

  it("agrees between the rows and the total for a contact-only match", async () => {
    const admin = await makeAdmin(`c5-${Date.now()}@x.com`);
    await publish(admin, "Nothing in the text", {
      contactName: "Zenobia Quartermain",
      contactEmail: "zq@oregonstate.edu",
    });

    const { rows, total } = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "Quartermain",
      pageSize: 50,
    });
    expect(rows.length).toBe(1);
    expect(total).toBe(1);
  });

  it("does not match on the proposer's name or address", async () => {
    // The exposure #336 and #402 removed: a hit against an otherwise empty
    // result would tell an anonymous visitor who proposed a project.
    //
    // `makeAdmin` stores the address as the account's name too, so both
    // queries below reach `user.name` and `user.email`, which the admin
    // listing matches and this one must not. Neither shares a word with the
    // title, or the tsvector would match on that instead and the test would
    // pass for the wrong reason.
    const admin = await makeAdmin(`quillfeather-${Date.now()}@x.com`);
    const id = await publish(admin, "Sensor mesh");

    for (const query of ["quillfeather", "@x.com"]) {
      const { rows } = await searchProjectsImpl({ ...SEARCH_DEFAULTS, query });
      expect(
        rows.map((r) => r.id),
        query
      ).not.toContain(id);
    }
  });

  it("still answers the quoted phrase and -exclude syntax", async () => {
    const admin = await makeAdmin(`c6-${Date.now()}@x.com`);
    const both = await publish(admin, "Machine learning pipeline", {
      description: "machine learning for sensor data",
    });
    const excluded = await publish(admin, "Machine shop scheduling", {
      description: "machine tooling and shop floor",
    });

    const phrase = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: '"machine learning"',
      pageSize: 50,
    });
    expect(phrase.rows.map((r) => r.id)).toContain(both);
    expect(phrase.rows.map((r) => r.id)).not.toContain(excluded);

    const minus = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      query: "machine -shop",
      pageSize: 50,
    });
    expect(minus.rows.map((r) => r.id)).toContain(both);
    expect(minus.rows.map((r) => r.id)).not.toContain(excluded);
  });
});

/**
 * The listing's one ordering control, after #475 made the Sort select the
 * only thing that orders these rows in either view.
 *
 * The resolution table is the part worth pinning: two of the six orderings
 * cannot always be delivered, and each degrades on the server rather than at
 * the call site, so `order` on the result is what the select shows and it can
 * never describe an order the rows are not in.
 */
describe("the public listing's ordering", () => {
  it("orders by title, oldest and recently updated on request", async () => {
    const admin = await makeAdmin(`o1-${Date.now()}@x.com`);
    const banana = await publish(admin, "banana project");
    const apple = await publish(admin, "Apple project");
    const cherry = await publish(admin, "Cherry project");
    const input = { ...SEARCH_DEFAULTS, pageSize: 50 };

    // Case-insensitive, or "Apple" and "Cherry" would both precede "banana".
    const byTitle = await searchProjectsImpl({ ...input, sort: "title" });
    expect(byTitle.rows.map((r) => r.title)).toEqual([
      "Apple project",
      "banana project",
      "Cherry project",
    ]);
    expect(byTitle.order).toBe("title");

    // Published in the order banana, apple, cherry.
    const oldest = await searchProjectsImpl({ ...input, sort: "oldest" });
    expect(oldest.rows.map((r) => r.id)).toEqual([banana, apple, cherry]);
    expect(oldest.order).toBe("oldest");

    const newest = await searchProjectsImpl({ ...input, sort: "newest" });
    expect(newest.rows.map((r) => r.id)).toEqual([cherry, apple, banana]);

    // `updated` is its own column, not the listing date: touching the oldest
    // row must float it to the top, which is exactly what the argument in
    // search.ts objects to for an IMPLICIT ordering and what a reader asking
    // for it by name has asked for.
    await db
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, banana));
    const updated = await searchProjectsImpl({ ...input, sort: "updated" });
    expect(updated.rows[0].id).toBe(banana);
    expect(updated.order).toBe("updated");
  });

  it("resolves relevance to newest when the box is empty", async () => {
    const admin = await makeAdmin(`o2-${Date.now()}@x.com`);
    const first = await publish(admin, "Earlier");
    const second = await publish(admin, "Later");

    // The duplication #475 removed: with no query `ts_rank` is 0 for every
    // row, so this compiled to exactly what `newest` compiles to while the
    // select said "Most relevant".
    const empty = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: "relevance",
      query: "",
    });
    expect(empty.order).toBe("newest");
    expect(empty.rows.map((r) => r.id)).toEqual([second, first]);

    // With a query it is a real ordering and stays itself.
    const typed = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: "relevance",
      query: "Earlier",
    });
    expect(typed.order).toBe("relevance");
  });

  it("resolves an absent sort by the viewer's vector and the query", async () => {
    const admin = await makeAdmin(`o3-${Date.now()}@x.com`);
    await publish(admin, "Anything at all");

    // No vector, empty box: Newest, not Most relevant. This is the line a
    // signed-out visitor lands on.
    const bare = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: undefined,
    });
    expect(bare.order).toBe("newest");
    expect(bare.viewer.canRecommend).toBe(false);

    // No vector, query typed: relevance, which is a real ordering here.
    const typed = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: undefined,
      query: "anything",
    });
    expect(typed.order).toBe("relevance");
  });

  it("falls back from recommended to the no-vector default", async () => {
    const admin = await makeAdmin(`o4-${Date.now()}@x.com`);
    await publish(admin, "Fallback subject");

    // A hand-typed ?order=recommended from a viewer with no vector: the page
    // renders and says which ordering it actually used, rather than promising
    // one it cannot deliver.
    const empty = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: "recommended",
    });
    expect(empty.order).toBe("newest");

    const typed = await searchProjectsImpl({
      ...SEARCH_DEFAULTS,
      sort: "recommended",
      query: "fallback",
    });
    expect(typed.order).toBe("relevance");
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
      acceptingApplicants: true,
      teamsSupported: 1,
    });
    await updateProjectProgramsAs(admin, {
      id: onlyHere,
      programIds: [corvallis.id],
      acceptingApplicants: true,
      teamsSupported: 1,
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
    await updateProjectProgramsAs(admin, {
      id,
      programIds: [a.id, b.id],
      acceptingApplicants: true,
      teamsSupported: 1,
    });

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

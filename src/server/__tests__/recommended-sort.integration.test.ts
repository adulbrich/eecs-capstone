import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user, userInterests } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import { searchProjectsImpl } from "#/server/_internal/search";

/** Unit vectors in a 1024-dim space, so cosine distance is predictable. */
function unitVector(axis: number) {
  return Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
}

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

function baseProject(title: string) {
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
    notes: null,
  };
}

async function publishWithVector(
  admin: { id: string; role: string | null },
  title: string,
  vector: number[] | null
) {
  const { id } = await createProjectAs(admin, baseProject(title));
  await performTransitionAs(admin, id, "submitted");
  await performTransitionAs(admin, id, "approved");
  await performTransitionAs(admin, id, "published");
  await db
    .update(projects)
    .set({ embedding: vector, embeddingSourceHash: vector ? "test" : null })
    .where(eq(projects.id, id));
  return id;
}

const SEARCH_DEFAULTS = {
  query: "",
  categoryIds: [],
  programId: null,
  archivedOnly: false,
  acceptingOnly: false,
  studentProposedOnly: false,
  requiresNdaOnly: false,
  page: 1,
  pageSize: 20,
};

describe("sort=recommended", () => {
  it("orders by cosine distance from the viewer's interest vector", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    await publishWithVector(admin, "Near", unitVector(0));
    await publishWithVector(admin, "Far", unitVector(1));
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      admin.id
    );
    expect(rows.map((r) => r.title)).toEqual(["Near", "Far"]);
  });

  it("places projects with no embedding last, without dropping them", async () => {
    const admin = await makeAdmin(`b-${Date.now()}@x.com`);
    await publishWithVector(admin, "Embedded", unitVector(0));
    await publishWithVector(admin, "Unembedded", null);
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      admin.id
    );
    expect(rows.map((r) => r.title)).toEqual(["Embedded", "Unembedded"]);
  });

  it("keeps the program filter applied", async () => {
    const admin = await makeAdmin(`c-${Date.now()}@x.com`);
    await publishWithVector(admin, "No program", unitVector(0));
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    const { rows } = await searchProjectsImpl(
      {
        ...SEARCH_DEFAULTS,
        sort: "recommended",
        programId: "00000000-0000-0000-0000-000000000123",
      },
      admin.id
    );
    expect(rows.length).toBe(0);
  });

  // "date ordering", not "relevance": with an empty box relevance itself
  // resolves to newest since #475, so the fallback lands there. The rows are
  // what this asserts and they are unchanged.
  it("falls back to date ordering when the viewer has no vector", async () => {
    const admin = await makeAdmin(`d-${Date.now()}@x.com`);
    await publishWithVector(admin, "First", unitVector(0));
    await publishWithVector(admin, "Second", unitVector(1));
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics with no vector",
    });

    const { rows, viewer } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      admin.id
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
    // What the filter bar reads to show "Add your interests" (#321).
    expect(viewer).toEqual({ signedIn: true, canRecommend: false });
  });

  it("falls back to date ordering for a signed-out viewer", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    await publishWithVector(admin, "First", unitVector(0));
    await publishWithVector(admin, "Second", unitVector(1));

    const { rows, viewer } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      null
    );
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
    expect(viewer).toEqual({ signedIn: false, canRecommend: false });
  });

  it("reports a viewer with a vector as able to sort by recommendation, whatever the sort", async () => {
    const admin = await makeAdmin(`g-${Date.now()}@x.com`);
    await publishWithVector(admin, "Only", unitVector(0));
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    // Read under the default sort: the listing decides whether to offer the
    // recommended sort before anyone has picked it.
    const { viewer } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "relevance" },
      admin.id
    );
    expect(viewer).toEqual({ signedIn: true, canRecommend: true });
  });
});

/**
 * The whole of #424: a member who wrote interests should not have to find the
 * sort in a Select on every visit. The trigger is the vector, never the text,
 * so the default never promises an order it cannot deliver.
 */
describe("an absent sort resolves by the viewer's vector", () => {
  async function viewerWithVector(email: string) {
    const admin = await makeAdmin(email);
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });
    return admin;
  }

  it("ranks by cosine distance and says so", async () => {
    const admin = await viewerWithVector(`d1-${Date.now()}@x.com`);
    await publishWithVector(admin, "Near", unitVector(0));
    await publishWithVector(admin, "Far", unitVector(1));

    const { rows, order } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: undefined },
      admin.id
    );
    expect(order).toBe("recommended");
    expect(rows.map((r) => r.title)).toEqual(["Near", "Far"]);
  });

  /**
   * Both halves of the no-vector row of #475's resolution table. It used to
   * be `relevance` whatever the box held, which was the duplication that
   * issue removed: with nothing typed, relevance ranked by a `ts_rank` that
   * is 0 for every row and fell through to the same date ordering `newest`
   * uses, while the select said "Most relevant".
   */
  it("resolves a visitor by whether a query is typed", async () => {
    const admin = await makeAdmin(`d2-${Date.now()}@x.com`);
    await publishWithVector(admin, "Near", unitVector(0));
    await publishWithVector(admin, "Far", unitVector(1));

    const empty = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: undefined },
      null
    );
    expect(empty.order).toBe("newest");

    const typed = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: undefined, query: "near" },
      null
    );
    expect(typed.order).toBe("relevance");
  });

  /**
   * The case the vector gate exists for: interests saved, the embedding call
   * failed or was off, so there is text but nothing to rank against.
   */
  it("falls back to relevance for a member whose interests never embedded", async () => {
    const admin = await makeAdmin(`d3-${Date.now()}@x.com`);
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics",
      embedding: null,
      embeddingSourceHash: null,
    });
    await publishWithVector(admin, "Near", unitVector(0));

    const { order } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: undefined },
      admin.id
    );
    // The same no-vector row of the table as the visitor above: the gate is
    // the vector, and with an empty box that row is `newest`.
    expect(order).toBe("newest");
  });

  it("lets an explicit sort win over the vector", async () => {
    const admin = await viewerWithVector(`d4-${Date.now()}@x.com`);
    await publishWithVector(admin, "Near", unitVector(0));
    await publishWithVector(admin, "Far", unitVector(1));

    const { order, rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "relevance" },
      admin.id
    );
    // Reported as `newest`, because an empty box resolves relevance onward
    // (#475). What this case is really about is the rows below: an explicit
    // sort that is not `recommended` beat the vector.
    expect(order).toBe("newest");
    // The rows, not just the label. Three things have to line up for a case
    // to catch a widened SQL branch: a vector, an explicit sort that is not
    // recommended, and rows whose cosine and relevance orders disagree. The
    // third is the one that is easy to lose: two rows are not enough, they
    // have to be built to disagree, which is what the unit vectors on
    // different axes and the publish order below do. Those are orthogonal,
    // not opposite: `unitVector` is one-hot, so any two axes sit at cosine
    // distance 1 and a third would tie rather than sort between them. `Far`
    // publishes second, so date-DESC puts it first, the reverse of cosine.
    // This is the only case in the file with all three; asserting the label
    // alone let that widening stay green.
    expect(rows.map((row) => row.title)).toEqual(["Far", "Near"]);
  });

  /**
   * A hand-typed `?order=recommended` from a viewer with no vector. The page
   * renders rather than erroring, and reports the ordering it actually used
   * so the Select cannot claim one the rows are not in.
   */
  it("reports what it used when recommended is asked for without a vector", async () => {
    const admin = await makeAdmin(`d5-${Date.now()}@x.com`);
    await publishWithVector(admin, "Near", unitVector(0));

    const empty = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      admin.id
    );
    expect(empty.order).toBe("newest");

    // With a query the same fallback lands on relevance, which is a real
    // ordering there rather than another name for the date.
    const typed = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended", query: "near" },
      admin.id
    );
    expect(typed.order).toBe("relevance");
  });

  it("filters by the query and still ranks by cosine", async () => {
    const admin = await viewerWithVector(`d6-${Date.now()}@x.com`);
    await publishWithVector(admin, "Rover near", unitVector(0));
    await publishWithVector(admin, "Rover far", unitVector(1));
    await publishWithVector(admin, "Greenhouse", unitVector(0));

    const { rows, order } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, query: "rover", sort: undefined },
      admin.id
    );
    expect(order).toBe("recommended");
    expect(rows.map((r) => r.title)).toEqual(["Rover near", "Rover far"]);
  });

  it("ranks the archive by cosine too", async () => {
    const admin = await viewerWithVector(`d7-${Date.now()}@x.com`);
    const near = await publishWithVector(admin, "Near", unitVector(0));
    const far = await publishWithVector(admin, "Far", unitVector(1));
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(inArray(projects.id, [near, far]));

    const { rows, order } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, archivedOnly: true, sort: undefined },
      admin.id
    );
    expect(order).toBe("recommended");
    expect(rows.map((r) => r.title)).toEqual(["Near", "Far"]);
  });
});

describe("default ordering is unchanged", () => {
  it("still ranks a keyword search by relevance, not by date", async () => {
    const admin = await makeAdmin(`f-${Date.now()}@x.com`);
    const { id: older } = await createProjectAs(admin, {
      ...baseProject("Rover telemetry"),
      description: "rover rover rover",
    });
    await performTransitionAs(admin, older, "submitted");
    await performTransitionAs(admin, older, "approved");
    await performTransitionAs(admin, older, "published");

    const { id: newer } = await createProjectAs(admin, {
      ...baseProject("Greenhouse"),
      description: "mentions rover once",
    });
    await performTransitionAs(admin, newer, "submitted");
    await performTransitionAs(admin, newer, "approved");
    await performTransitionAs(admin, newer, "published");

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, query: "rover", sort: "relevance" },
      null
    );
    expect(rows[0].title).toBe("Rover telemetry");
  });
});

import { eq } from "drizzle-orm";
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
    programId: null,
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

  it("falls back to relevance ordering when the viewer has no vector", async () => {
    const admin = await makeAdmin(`d-${Date.now()}@x.com`);
    await publishWithVector(admin, "First", unitVector(0));
    await publishWithVector(admin, "Second", unitVector(1));
    await db.insert(userInterests).values({
      userId: admin.id,
      interestsText: "robotics with no vector",
    });

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      admin.id
    );
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
  });

  it("falls back to relevance ordering for a signed-out viewer", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    await publishWithVector(admin, "First", unitVector(0));
    await publishWithVector(admin, "Second", unitVector(1));

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "recommended" },
      null
    );
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
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

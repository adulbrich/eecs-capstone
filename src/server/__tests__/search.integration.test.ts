import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
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
    programId: null,
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

  it("acceptingOnly hides projects that are not accepting applicants", async () => {
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
    // four the listing has no use for (notes, isSponsored, programId,
    // deletedAt) plus the correlated categories string. proposerEmail and
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
      "mentorName",
      "minQualifications",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "programCourseId",
      "programCourseName",
      "requiresNdaIp",
      "seekingMentor",
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

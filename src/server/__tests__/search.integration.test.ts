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
  body: Partial<ReturnType<typeof baseProject>> = {}
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

describe("searchProjects", () => {
  it("ranks title hit above description hit for the same query", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const titleId = await publish(admin, "React UI Library");
    const descId = await publish(admin, "Random thing", {
      description: "uses react under the hood",
    });

    const { rows } = await searchProjectsImpl({
      query: "react",
      categoryIds: [],
      programId: null,
      archivedOnly: false,
      page: 1,
      pageSize: 20,
    });
    expect(rows[0].id).toBe(titleId);
    const order = rows.map((r) => r.id);
    expect(order.indexOf(titleId)).toBeLessThan(order.indexOf(descId));
  });

  it("does not return non-published projects", async () => {
    const admin = await makeAdmin(`a2-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Draft project"));
    const { rows } = await searchProjectsImpl({
      query: "",
      categoryIds: [],
      programId: null,
      archivedOnly: false,
      page: 1,
      pageSize: 20,
    });
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });

  it("empty query falls back to publishedAt desc", async () => {
    const admin = await makeAdmin(`a3-${Date.now()}@x.com`);
    const first = await publish(admin, "First");
    const second = await publish(admin, "Second");
    const { rows } = await searchProjectsImpl({
      query: "",
      categoryIds: [],
      programId: null,
      archivedOnly: false,
      page: 1,
      pageSize: 20,
    });
    const order = rows.map((r) => r.id);
    expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
  });

  it("whitespace-only query is treated as empty", async () => {
    const admin = await makeAdmin(`a4-${Date.now()}@x.com`);
    await publish(admin, "Anything");
    const { rows } = await searchProjectsImpl({
      query: "   ",
      categoryIds: [],
      programId: null,
      archivedOnly: false,
      page: 1,
      pageSize: 20,
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

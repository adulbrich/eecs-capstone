import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { categories, programs, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createCategoryAs,
  deleteCategoryAs,
  listCategoriesImpl,
  updateCategoryAs,
} from "#/server/_internal/categories";
import {
  createProgramAs,
  deleteProgramAs,
  listProgramsImpl,
  updateProgramAs,
} from "#/server/_internal/programs";
import { listProjectFilterOptionsImpl } from "#/server/_internal/project-filter-options";

// `vitest.integration.config.ts` turns the cache on, so the first read in each
// test below is cached, and every later one reads stale unless something
// cleared it (#558, ADR-0048).

async function makeAdmin(email: string) {
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function options() {
  const { categories: c, programs: p } = await listProjectFilterOptionsImpl();
  return {
    categories: c.map((r) => r.name),
    programs: p.map((r) => r.courseId),
  };
}

describe("the listing's cached filter options", () => {
  it("returns project categories only, beside every program", async () => {
    const admin = await makeAdmin(`fo-${Date.now()}@x.com`);
    await createCategoryAs(admin, {
      domain: "project",
      name: "React",
      type: "technology",
    });
    await createCategoryAs(admin, {
      domain: "inventory",
      name: "Electronics",
      type: null,
    });
    await createProgramAs(admin, {
      courseId: "CS461",
      courseName: "Capstone",
      description: null,
    });

    expect(await options()).toEqual({
      categories: ["React"],
      programs: ["CS461"],
    });
  });

  it("shows a staff create, edit and delete on the task that made it", async () => {
    const admin = await makeAdmin(`fo-w-${Date.now()}@x.com`);
    expect(await options()).toEqual({ categories: [], programs: [] });

    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "project",
      name: "Rust",
      type: "technology",
    });
    const { id: programId } = await createProgramAs(admin, {
      courseId: "CS461",
      courseName: "Capstone",
      description: null,
    });
    expect(await options()).toEqual({
      categories: ["Rust"],
      programs: ["CS461"],
    });

    await updateCategoryAs(admin, {
      id: categoryId,
      domain: "project",
      name: "Go",
      type: "technology",
    });
    expect((await options()).categories).toEqual(["Go"]);
    await updateProgramAs(admin, {
      id: programId,
      courseId: "CS462",
      courseName: "Capstone",
      description: null,
    });
    expect((await options()).programs).toEqual(["CS462"]);

    await deleteCategoryAs(admin, categoryId);
    expect((await options()).categories).toEqual([]);
    await deleteProgramAs(admin, programId);
    expect((await options()).programs).toEqual([]);
  });

  it("serves a write made behind its back from the cache, and only here", async () => {
    // The trade ADR-0048 accepts: a row written by another task, or here
    // straight to the database, is missing from the listing until the entry
    // expires. The staff reads underneath are not cached, which is what keeps
    // an edit form's picker current.
    expect(await options()).toEqual({ categories: [], programs: [] });
    await db
      .insert(categories)
      .values({ domain: "project", name: "Elsewhere", type: "technology" });
    await db
      .insert(programs)
      .values({ courseId: "ELSEWHERE", courseName: "Elsewhere" });

    expect(await options()).toEqual({ categories: [], programs: [] });
    const { rows: direct } = await listCategoriesImpl({ domain: "project" });
    expect(direct.map((r) => r.name)).toEqual(["Elsewhere"]);
    const { rows: directPrograms } = await listProgramsImpl();
    expect(directPrograms.map((r) => r.courseId)).toEqual(["ELSEWHERE"]);
  });
});

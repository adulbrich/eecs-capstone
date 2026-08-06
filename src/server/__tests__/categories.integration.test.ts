import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projectCategories, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createCategoryAs,
  deleteCategoryAs,
  listCategoriesImpl,
  listCategoryTypesImpl,
  setProjectCategoriesAs,
} from "#/server/_internal/categories";
import { createProjectAs } from "#/server/_internal/projects";

async function makeUser(email: string, role: "user" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "admin" ? { role } : {}) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
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
    programId: null,
    notes: null,
  };
}

describe("categories", () => {
  it("staff can create; deletion cascades project_categories", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const { id: catId } = await createCategoryAs(admin, {
      domain: "project",
      name: "react",
      type: "technology",
    });
    const { id: projId } = await createProjectAs(admin, baseProject());
    await setProjectCategoriesAs(admin, {
      projectId: projId,
      categoryIds: [catId],
    });

    const before = await db
      .select()
      .from(projectCategories)
      .where(eq(projectCategories.projectId, projId));
    expect(before.length).toBe(1);

    await deleteCategoryAs(admin, catId);

    const after = await db
      .select()
      .from(projectCategories)
      .where(eq(projectCategories.projectId, projId));
    expect(after.length).toBe(0);
  });

  it("non-staff cannot create", async () => {
    const u = await makeUser(`u-${Date.now()}@x.com`, "user");
    await expect(
      createCategoryAs(u, { domain: "project", name: "x", type: "technology" })
    ).rejects.toThrow();
  });

  it("setProjectCategories replaces atomically", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const { id: c1 } = await createCategoryAs(admin, {
      domain: "project",
      name: "a",
      type: "technology",
    });
    const { id: c2 } = await createCategoryAs(admin, {
      domain: "project",
      name: "b",
      type: "technology",
    });
    const { id: c3 } = await createCategoryAs(admin, {
      domain: "project",
      name: "c",
      type: "technology",
    });
    const { id: projId } = await createProjectAs(admin, baseProject());

    await setProjectCategoriesAs(admin, {
      projectId: projId,
      categoryIds: [c1, c2],
    });
    await setProjectCategoriesAs(admin, {
      projectId: projId,
      categoryIds: [c3],
    });

    const rows = await db
      .select()
      .from(projectCategories)
      .where(eq(projectCategories.projectId, projId));
    expect(rows.map((r) => r.categoryId)).toEqual([c3]);
  });

  it("lists only the requested domain", async () => {
    const admin = await makeUser(`dom-${Date.now()}@x.com`, "admin");
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

    const projectOnly = await listCategoriesImpl({ domain: "project" });
    const inventoryOnly = await listCategoriesImpl({ domain: "inventory" });

    expect(projectOnly.rows.map((r) => r.name)).toEqual(["React"]);
    expect(inventoryOnly.rows.map((r) => r.name)).toEqual(["Electronics"]);
  });

  it("requires a type for a project category", async () => {
    const admin = await makeUser(`v1-${Date.now()}@x.com`, "admin");
    await expect(
      // @ts-expect-error a project category requires a non-null type; this
      // deliberately violates CategoryInput to prove the runtime assertion
      // catches what the type system also forbids at the call site.
      createCategoryAs(admin, { domain: "project", name: "Nope", type: null })
    ).rejects.toThrow(/requires a type/);
  });

  it("rejects a type on an inventory category rather than stripping it", async () => {
    const admin = await makeUser(`v2-${Date.now()}@x.com`, "admin");
    await expect(
      // @ts-expect-error an inventory category cannot carry a type; this
      // deliberately violates CategoryInput to prove the runtime assertion
      // catches what the type system also forbids at the call site.
      createCategoryAs(admin, {
        domain: "inventory",
        name: "Nope",
        type: "technology",
      })
    ).rejects.toThrow(/cannot have a type/);
  });

  it("derives types from project categories only", async () => {
    const admin = await makeUser(`t-${Date.now()}@x.com`, "admin");
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

    const { types } = await listCategoryTypesImpl();
    expect(types).toEqual(["technology"]);
  });
});

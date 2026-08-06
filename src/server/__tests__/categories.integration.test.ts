import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projectCategories, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { INVENTORY_CATEGORY_TYPE } from "#/lib/category-types";
import {
  createCategoryAs,
  deleteCategoryAs,
  listCategoriesImpl,
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
      createCategoryAs(u, { name: "x", type: "technology" })
    ).rejects.toThrow();
  });

  it("setProjectCategories replaces atomically", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const { id: c1 } = await createCategoryAs(admin, {
      name: "a",
      type: "technology",
    });
    const { id: c2 } = await createCategoryAs(admin, {
      name: "b",
      type: "technology",
    });
    const { id: c3 } = await createCategoryAs(admin, {
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

  it("excludes types the caller asked to omit", async () => {
    const admin = await makeUser(`ex-${Date.now()}@x.com`, "admin");
    await createCategoryAs(admin, { name: "React", type: "technology" });
    await createCategoryAs(admin, {
      name: "Electronics",
      type: INVENTORY_CATEGORY_TYPE,
    });

    const all = await listCategoriesImpl({});
    const projectOnly = await listCategoriesImpl({
      excludeTypes: [INVENTORY_CATEGORY_TYPE],
    });

    expect(all.rows.map((r) => r.name)).toContain("Electronics");
    expect(projectOnly.rows.map((r) => r.name)).not.toContain("Electronics");
    expect(projectOnly.rows.map((r) => r.name)).toContain("React");
  });
});

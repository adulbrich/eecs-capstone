import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  categories,
  inventoryItemCategories,
  inventoryItems,
  projectCategories,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createCategoryAs,
  deleteCategoryAs,
  listCategoriesImpl,
  listCategoriesWithUsageAs,
  listCategoryTypesImpl,
  listProjectCategoriesAs,
  setProjectCategoriesAs,
  updateCategoryAs,
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

  it("rejects changing a category's domain on update", async () => {
    const admin = await makeUser(`flip-${Date.now()}@x.com`, "admin");
    const { id: catId } = await createCategoryAs(admin, {
      domain: "project",
      name: "React",
      type: "technology",
    });

    // This object is a perfectly valid CategoryUpdateInput on its own (the
    // inventory variant); nothing about its shape is statically wrong. Only
    // the runtime guard knows catId belongs to a stored project-domain row,
    // which is exactly why the guard has to exist: the type system cannot
    // see the mismatch between an id and its own database row.
    await expect(
      updateCategoryAs(admin, {
        id: catId,
        domain: "inventory",
        name: "React",
        type: null,
      })
    ).rejects.toThrow(/domain cannot be changed/);

    const [row] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, catId));
    expect(row.domain).toBe("project");
    expect(row.type).toBe("technology");
  });
});

describe("listCategoriesWithUsageAs", () => {
  it("counts published and archived projects but not drafts or deleted ones", async () => {
    const admin = await makeUser("usage-admin@x.com", "admin");
    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "project",
      name: "Robotics",
      type: "technology",
    });

    const inserted = await db
      .insert(projects)
      .values([
        { title: "Published", status: "published" },
        { title: "Archived", status: "archived" },
        { title: "Draft", status: "draft" },
        { title: "Deleted", status: "published", deletedAt: new Date() },
      ])
      .returning({ id: projects.id });
    await db
      .insert(projectCategories)
      .values(inserted.map((p) => ({ projectId: p.id, categoryId })));

    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "project",
    });
    const row = rows.find((r) => r.id === categoryId);
    expect(row?.usageCount).toBe(2);
  });

  it("counts inventory items for an inventory category", async () => {
    const admin = await makeUser("usage-admin-2@x.com", "admin");
    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "inventory",
      name: "Cables",
      type: null,
    });
    const items = await db
      .insert(inventoryItems)
      .values([{ name: "USB-C" }, { name: "HDMI" }])
      .returning({ id: inventoryItems.id });
    await db
      .insert(inventoryItemCategories)
      .values(items.map((i) => ({ itemId: i.id, categoryId })));

    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "inventory",
    });
    expect(rows.find((r) => r.id === categoryId)?.usageCount).toBe(2);
  });

  it("returns a number, not a bigint string", async () => {
    const admin = await makeUser("usage-admin-3@x.com", "admin");
    await createCategoryAs(admin, {
      domain: "inventory",
      name: "Empty",
      type: null,
    });
    const { rows } = await listCategoriesWithUsageAs(admin, {
      domain: "inventory",
    });
    expect(typeof rows[0].usageCount).toBe("number");
  });

  it("refuses a non-staff viewer", async () => {
    const student = await makeUser("usage-student@x.com", "user");
    await expect(
      listCategoriesWithUsageAs(student, { domain: "project" })
    ).rejects.toThrow("Forbidden");
  });
});

describe("listProjectCategoriesAs", () => {
  async function draftWithCategory() {
    const admin = await makeUser(`lpc-admin-${Date.now()}@x.com`, "admin");
    const proposer = await makeUser(`lpc-owner-${Date.now()}@x.com`, "user");
    const { id: categoryId } = await createCategoryAs(admin, {
      domain: "project",
      name: `Robotics ${Date.now()}`,
      type: "technology",
    });
    const { id: projectId } = await createProjectAs(proposer, baseProject());
    await db.insert(projectCategories).values({ projectId, categoryId });
    return { admin, proposer, projectId, categoryId };
  }

  it("refuses a stranger and an anonymous viewer on a draft", async () => {
    const { projectId } = await draftWithCategory();
    const stranger = await makeUser(`lpc-stranger-${Date.now()}@x.com`, "user");
    await expect(
      listProjectCategoriesAs(stranger, { projectId })
    ).rejects.toThrow("Forbidden");
    await expect(listProjectCategoriesAs(null, { projectId })).rejects.toThrow(
      "Forbidden"
    );
  });

  it("returns the rows to the proposer and to staff on a draft", async () => {
    const { admin, proposer, projectId, categoryId } =
      await draftWithCategory();
    const own = await listProjectCategoriesAs(proposer, { projectId });
    expect(own.rows.map((r) => r.id)).toEqual([categoryId]);
    const staff = await listProjectCategoriesAs(admin, { projectId });
    expect(staff.rows.map((r) => r.id)).toEqual([categoryId]);
  });

  it("returns the rows to anyone on a published project", async () => {
    const { projectId, categoryId } = await draftWithCategory();
    await db
      .update(projects)
      .set({ status: "published" })
      .where(eq(projects.id, projectId));
    const { rows } = await listProjectCategoriesAs(null, { projectId });
    expect(rows.map((r) => r.id)).toEqual([categoryId]);
  });

  it("refuses an unknown project id the same way", async () => {
    await expect(
      listProjectCategoriesAs(null, {
        projectId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow("Forbidden");
  });
});

describe("category name collisions", () => {
  it("create names the existing row on an exact duplicate", async () => {
    const admin = await makeUser(`col-admin-${Date.now()}@x.com`, "admin");
    const name = `Vision ${Date.now()}`;
    await createCategoryAs(admin, {
      domain: "project",
      name,
      type: "technology",
    });
    await expect(
      createCategoryAs(admin, { domain: "project", name, type: "technology" })
    ).rejects.toThrow(
      `A category named "${name}" already exists with type "technology".`
    );
  });

  it("create names the stored spelling on a case variant", async () => {
    const admin = await makeUser(`col-admin2-${Date.now()}@x.com`, "admin");
    const stored = `Robotics ${Date.now()}`;
    await createCategoryAs(admin, {
      domain: "project",
      name: stored,
      type: "technology",
    });
    await expect(
      createCategoryAs(admin, {
        domain: "project",
        name: stored.toLowerCase(),
        type: "technology",
      })
    ).rejects.toThrow(
      `A category named "${stored}" already exists with type "technology".`
    );
  });

  it("create in the inventory domain omits the type clause", async () => {
    const admin = await makeUser(`col-admin3-${Date.now()}@x.com`, "admin");
    const name = `Cables ${Date.now()}`;
    await createCategoryAs(admin, { domain: "inventory", name, type: null });
    await expect(
      createCategoryAs(admin, {
        domain: "inventory",
        name: name.toUpperCase(),
        type: null,
      })
    ).rejects.toThrow(`A category named "${name}" already exists.`);
  });

  it("create allows the same name in another domain or type", async () => {
    const admin = await makeUser(`col-admin4-${Date.now()}@x.com`, "admin");
    const name = `Shared ${Date.now()}`;
    await createCategoryAs(admin, {
      domain: "project",
      name,
      type: "technology",
    });
    await expect(
      createCategoryAs(admin, { domain: "project", name, type: "domain" })
    ).resolves.toMatchObject({ id: expect.any(String) });
    await expect(
      createCategoryAs(admin, { domain: "inventory", name, type: null })
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("update names the existing row when renaming onto it", async () => {
    const admin = await makeUser(`col-admin5-${Date.now()}@x.com`, "admin");
    const taken = `Taken ${Date.now()}`;
    await createCategoryAs(admin, {
      domain: "project",
      name: taken,
      type: "technology",
    });
    const { id } = await createCategoryAs(admin, {
      domain: "project",
      name: `Free ${Date.now()}`,
      type: "technology",
    });
    await expect(
      updateCategoryAs(admin, {
        id,
        domain: "project",
        name: taken.toUpperCase(),
        type: "technology",
      })
    ).rejects.toThrow(
      `A category named "${taken}" already exists with type "technology".`
    );
  });

  it("update names the existing row on an exact duplicate", async () => {
    const admin = await makeUser(`col-admin7-${Date.now()}@x.com`, "admin");
    const taken = `Exact ${Date.now()}`;
    await createCategoryAs(admin, {
      domain: "project",
      name: taken,
      type: "technology",
    });
    const { id } = await createCategoryAs(admin, {
      domain: "project",
      name: `Other ${Date.now()}`,
      type: "technology",
    });
    await expect(
      updateCategoryAs(admin, {
        id,
        domain: "project",
        name: taken,
        type: "technology",
      })
    ).rejects.toThrow(
      `A category named "${taken}" already exists with type "technology".`
    );
  });

  it("update allows renaming onto a name held under another type", async () => {
    const admin = await makeUser(`col-admin8-${Date.now()}@x.com`, "admin");
    const name = `Held ${Date.now()}`;
    await createCategoryAs(admin, { domain: "project", name, type: "domain" });
    const { id } = await createCategoryAs(admin, {
      domain: "project",
      name: `Renaming ${Date.now()}`,
      type: "technology",
    });
    await expect(
      updateCategoryAs(admin, {
        id,
        domain: "project",
        name,
        type: "technology",
      })
    ).resolves.toEqual({ id });
  });

  it("update still allows saving a row under its own name", async () => {
    const admin = await makeUser(`col-admin6-${Date.now()}@x.com`, "admin");
    const name = `Self ${Date.now()}`;
    const { id } = await createCategoryAs(admin, {
      domain: "project",
      name,
      type: "technology",
    });
    await expect(
      updateCategoryAs(admin, {
        id,
        domain: "project",
        name,
        type: "technology",
      })
    ).resolves.toEqual({ id });
  });
});

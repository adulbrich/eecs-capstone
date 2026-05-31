import { eq } from "drizzle-orm";
import { db } from "#/db";
import { categories, projectCategories, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canSeeProject, isStaff } from "#/lib/project-visibility";
import type {
  CategoryInput,
  CategoryUpdateInput,
  SetProjectCategoriesInput,
} from "../categories";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function viewerToVisibility(viewer: AuthUser) {
  return { id: viewer.id, role: viewer.role ?? null };
}

function assertStaff(viewer: AuthUser) {
  if (!isStaff(viewerToVisibility(viewer))) {
    throw new Error("Forbidden");
  }
}

export async function listCategoriesImpl(data: { type?: string | null }) {
  const rows = data.type
    ? await db
        .select()
        .from(categories)
        .where(eq(categories.type, data.type))
        .orderBy(categories.name)
    : await db
        .select()
        .from(categories)
        .orderBy(categories.type, categories.name);
  return { rows };
}

export async function listCategoryTypesImpl() {
  const rows = await db
    .select({ type: categories.type })
    .from(categories)
    .groupBy(categories.type)
    .orderBy(categories.type);
  return { types: rows.map((r) => r.type) };
}

export async function getCategoryImpl(data: { id: string }) {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, data.id));
  if (!row) {
    throw new Error("Category not found");
  }
  return { category: row };
}

export async function createCategoryAs(viewer: AuthUser, data: CategoryInput) {
  assertStaff(viewer);
  const [row] = await db
    .insert(categories)
    .values({ name: data.name, type: data.type })
    .returning();
  return { id: row.id };
}

export async function createCategoryForCurrentUser(data: CategoryInput) {
  const viewer = await requireUser();
  return createCategoryAs(viewer, data);
}

export async function updateCategoryAs(
  viewer: AuthUser,
  data: CategoryUpdateInput
) {
  assertStaff(viewer);
  await db
    .update(categories)
    .set({ name: data.name, type: data.type })
    .where(eq(categories.id, data.id));
  return { id: data.id };
}

export async function updateCategoryForCurrentUser(data: CategoryUpdateInput) {
  const viewer = await requireUser();
  return updateCategoryAs(viewer, data);
}

export async function deleteCategoryAs(viewer: AuthUser, id: string) {
  assertStaff(viewer);
  await db.delete(categories).where(eq(categories.id, id));
  return { id };
}

export async function deleteCategoryForCurrentUser(id: string) {
  const viewer = await requireUser();
  return deleteCategoryAs(viewer, id);
}

export async function setProjectCategoriesAs(
  viewer: AuthUser,
  data: SetProjectCategoriesInput
) {
  assertStaff(viewer);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  if (!canSeeProject(project, viewerToVisibility(viewer))) {
    throw new Error("Forbidden");
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, data.projectId));
    if (data.categoryIds.length > 0) {
      await tx.insert(projectCategories).values(
        data.categoryIds.map((cid) => ({
          projectId: data.projectId,
          categoryId: cid,
        }))
      );
    }
  });
  return { projectId: data.projectId, count: data.categoryIds.length };
}

export async function setProjectCategoriesForCurrentUser(
  data: SetProjectCategoriesInput
) {
  const viewer = await requireUser();
  return setProjectCategoriesAs(viewer, data);
}

export async function listProjectCategoriesImpl(data: { projectId: string }) {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      type: categories.type,
    })
    .from(projectCategories)
    .innerJoin(categories, eq(projectCategories.categoryId, categories.id))
    .where(eq(projectCategories.projectId, data.projectId))
    .orderBy(categories.type, categories.name);
  return { rows };
}

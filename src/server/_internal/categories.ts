import { and, eq, isNotNull, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  categories,
  type categoryDomainEnum,
  inventoryItemCategories,
  projectCategories,
  projects,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canSeeProject } from "#/lib/project-visibility";
import { assertStaff } from "#/lib/viewer";
import type {
  CategoryInput,
  CategoryUpdateInput,
  SetProjectCategoriesInput,
} from "../categories";
import type { Tx } from "./inventory-transitions";

type CategoryDomain = (typeof categoryDomainEnum.enumValues)[number];

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function viewerToVisibility(viewer: AuthUser) {
  return { id: viewer.id, role: viewer.role ?? null };
}

export async function listCategoriesImpl(data: {
  domain?: CategoryDomain | null;
  type?: string | null;
}) {
  const conditions: SQL[] = [];
  if (data.domain) {
    conditions.push(eq(categories.domain, data.domain));
  }
  if (data.type) {
    conditions.push(eq(categories.type, data.type));
  }
  const rows = await db
    .select()
    .from(categories)
    .where(conditions.length ? and(...conditions) : undefined)
    // Type first groups the project pickers. Inventory rows all have a null
    // type, so within that domain this collapses to name order.
    .orderBy(categories.type, categories.name);
  return { rows };
}

export async function listCategoryTypesImpl() {
  const rows = await db
    .select({ type: categories.type })
    .from(categories)
    // Facets exist only in the project domain; inventory categories are flat.
    .where(and(eq(categories.domain, "project"), isNotNull(categories.type)))
    .groupBy(categories.type)
    .orderBy(categories.type);
  return { types: rows.map((r) => r.type).filter((t): t is string => !!t) };
}

/**
 * A project category is filed under a facet; an inventory category is flat.
 * Rejecting a supplied inventory type rather than discarding it is deliberate:
 * silent stripping is the failure class this redesign removes.
 */
function assertDomainShape(data: {
  domain: CategoryDomain;
  type: string | null;
}) {
  if (data.domain === "project" && !data.type?.trim()) {
    throw new Error("A project category requires a type");
  }
  if (data.domain === "inventory" && data.type !== null) {
    throw new Error("An inventory category cannot have a type");
  }
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
  assertDomainShape(data);
  const [row] = await db
    .insert(categories)
    .values({ name: data.name, domain: data.domain, type: data.type })
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
  assertDomainShape(data);
  const [existing] = await db
    .select({ domain: categories.domain })
    .from(categories)
    .where(eq(categories.id, data.id));
  if (!existing) {
    throw new Error("Category not found");
  }
  // domain is a partition key fixed at creation, not an editable attribute:
  // a live project category flipped to inventory (or the reverse) would drop
  // out of listCategoriesImpl/listCategoryTypesImpl for its old domain while
  // its project_categories or inventory_item_categories rows silently stay
  // behind, orphaned. No database constraint ties domain to join-table
  // membership, so this has to be enforced here.
  if (existing.domain !== data.domain) {
    throw new Error("A category's domain cannot be changed");
  }
  await db
    .update(categories)
    .set({ name: data.name, domain: data.domain, type: data.type })
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

/**
 * Mirrors setProjectCategoriesAs's delete-then-insert shape, but takes an
 * optional transaction: item create and update already open a transaction
 * for the item write itself, and this needs to join it rather than open a
 * second pooled connection.
 */
export async function setInventoryItemCategoriesAs(
  viewer: AuthUser,
  data: { itemId: string; categoryIds: string[] },
  tx?: Tx
) {
  assertStaff(viewer);
  const run = async (executor: Tx) => {
    await executor
      .delete(inventoryItemCategories)
      .where(eq(inventoryItemCategories.itemId, data.itemId));
    if (data.categoryIds.length > 0) {
      await executor.insert(inventoryItemCategories).values(
        data.categoryIds.map((cid) => ({
          itemId: data.itemId,
          categoryId: cid,
        }))
      );
    }
  };
  if (tx) {
    await run(tx);
  } else {
    await db.transaction(run);
  }
  return { itemId: data.itemId, count: data.categoryIds.length };
}

/**
 * Counts what is filed under each category, in the same round trip that
 * fetches the rows.
 *
 * A CASE with both domains named explicitly, rather than one aggregate per
 * junction table joined onto every row: `categories.domain` is immutable
 * (see updateCategoryAs), so a project category can never have inventory
 * rows and Postgres evaluates only the arm its domain selects. `else 0`
 * rather than falling through to the inventory count, so a third domain
 * added later reports zero instead of silently reporting the wrong table.
 *
 * `::int` because count() returns bigint, which node-postgres hands back as
 * a string: without the cast the column arrives as "12" and sorts
 * lexicographically, putting 9 after 12.
 *
 * The whole fragment is wrapped in one extra `sql` layer. The outer query
 * below selects only from `categories`, no joins, so Drizzle's single-table
 * selection builder (pg-core/dialect.js) strips every column reference it
 * finds in a computed field down to a bare, unqualified name, assuming a
 * single-table query can only ever mean that table's own columns. That
 * assumption breaks a correlated subquery: unqualified "id" resolved to the
 * closer `projects.id` instead of the correlated `categories.id`, so
 * `category_id = id` compared a category uuid to a project uuid and always
 * counted 0. Nesting the fragment inside `sql\`${...}\`` keeps it out of
 * that shallow rewrite (it only rewrites bare Column chunks, not nested SQL
 * objects), so every column below renders fully table-qualified. Do not
 * unwrap this "for readability": it is the fix, not decoration.
 */
const usageCount = sql<number>`${sql`(
  case ${categories.domain}
    when 'project' then (
      select count(*)::int
      from ${projectCategories}
      join ${projects}
        on ${projects.id} = ${projectCategories.projectId}
       and ${projects.deletedAt} is null
       and ${projects.status} <> 'draft'
      where ${projectCategories.categoryId} = ${categories.id})
    when 'inventory' then (
      select count(*)::int
      from ${inventoryItemCategories}
      where ${inventoryItemCategories.categoryId} = ${categories.id})
    else 0
  end
)`}`;

/**
 * The staff-only sibling of listCategoriesImpl. Deliberately a separate
 * function rather than a flag: listCategories is reachable without a session
 * (the public project filter bar calls it), and it feeds two dropdowns that
 * have no use for an aggregate.
 *
 * A draft project is not counted. It is visible only to its owner, so
 * counting it would inflate the answer to "how much is filed here".
 */
export async function listCategoriesWithUsageAs(
  viewer: AuthUser,
  data: { domain?: CategoryDomain | null; type?: string | null }
) {
  assertStaff(viewer);
  const conditions: SQL[] = [];
  if (data.domain) {
    conditions.push(eq(categories.domain, data.domain));
  }
  if (data.type) {
    conditions.push(eq(categories.type, data.type));
  }
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      domain: categories.domain,
      type: categories.type,
      createdAt: categories.createdAt,
      usageCount,
    })
    .from(categories)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(categories.type, categories.name);
  return { rows };
}

export async function listCategoriesWithUsageForCurrentUser(data: {
  domain?: CategoryDomain | null;
  type?: string | null;
}) {
  const viewer = await requireUser();
  return listCategoriesWithUsageAs(viewer, data);
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

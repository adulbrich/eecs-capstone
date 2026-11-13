import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PROPOSAL_NAME_MAX_LENGTH } from "#/lib/categorize";
import {
  CLEANUP_MAX_MERGE_SOURCES,
  CLEANUP_MAX_OPERATIONS,
  CLEANUP_NAME_MAX_LENGTH,
} from "#/lib/category-cleanup";
import { CATEGORY_DESCRIPTION_MAX_LENGTH } from "#/lib/default-categories";

/**
 * Project categories only: it is the definition the categorizer reads, and
 * inventory categories are never categorized by a model. Optional, so a
 * category created from a picker carries none; the writers store a blank one
 * as null.
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(CATEGORY_DESCRIPTION_MAX_LENGTH)
  .optional();

export const categorySchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("project"),
    name: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(50),
    description: descriptionSchema,
  }),
  z.object({
    domain: z.literal("inventory"),
    name: z.string().trim().min(1).max(100),
    type: z.null(),
  }),
]);

export type CategoryInput = z.infer<typeof categorySchema>;

// z.discriminatedUnion does not support .extend(); each variant is rebuilt
// with id added instead.
const categoryUpdateSchema = z.discriminatedUnion("domain", [
  z.object({
    id: z.string().uuid(),
    domain: z.literal("project"),
    name: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(50),
    description: descriptionSchema,
  }),
  z.object({
    id: z.string().uuid(),
    domain: z.literal("inventory"),
    name: z.string().trim().min(1).max(100),
    type: z.null(),
  }),
]);

export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

const idSchema = z.object({ id: z.string().uuid() });

export const listSchema = z.object({
  domain: z.enum(["project", "inventory"]).nullable().optional(),
  type: z.string().nullable().optional(),
});

const setProjectCategoriesSchema = z.object({
  projectId: z.string().uuid(),
  categoryIds: z.array(z.string().uuid()).max(50),
});

export type SetProjectCategoriesInput = z.infer<
  typeof setProjectCategoriesSchema
>;

const projectCategorizationSchema = z.object({
  projectId: z.string().uuid(),
});

export type ProjectCategorizationInput = z.infer<
  typeof projectCategorizationSchema
>;

/**
 * A proposal staff approve, as edited in the form: the proposal itself is
 * never stored, so this is what the server checks (#31).
 */
const approveProposedCategorySchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(PROPOSAL_NAME_MAX_LENGTH),
  type: z.string().trim().min(1).max(50),
  description: descriptionSchema,
});

export type ApproveProposedCategoryInput = z.infer<
  typeof approveProposedCategorySchema
>;

/**
 * A category as the cleanup proposal saw it (#857). Compared, never written,
 * so the caps are loose ones that only bound the payload.
 */
const cleanupRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(1000),
  type: z.string().max(1000),
  description: z.string().max(2000).nullable(),
});

const cleanupNewText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

/**
 * The changes staff picked, as the proposal returned them: proposals are never
 * stored, so this is what the server checks. The reason and the effect ride
 * along from the browser and are stripped here.
 */
const applyCategoryCleanupSchema = z.object({
  changes: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("merge"),
          target: cleanupRefSchema,
          sources: z
            .array(cleanupRefSchema)
            .min(1)
            .max(CLEANUP_MAX_MERGE_SOURCES),
        }),
        z.object({
          kind: z.literal("rename"),
          category: cleanupRefSchema,
          name: cleanupNewText(CLEANUP_NAME_MAX_LENGTH),
          description: cleanupNewText(CATEGORY_DESCRIPTION_MAX_LENGTH),
        }),
        z.object({
          kind: z.literal("move"),
          category: cleanupRefSchema,
          type: z.string().trim().min(1).max(50),
        }),
        z.object({ kind: z.literal("retire"), category: cleanupRefSchema }),
      ])
    )
    .min(1)
    .max(CLEANUP_MAX_OPERATIONS),
});

export type ApplyCategoryCleanupInput = z.infer<
  typeof applyCategoryCleanupSchema
>;

/** The backfill's cursor: the last project this run reached, or null (#31). */
const categorizeNextSchema = z.object({
  after: z.string().uuid().nullable(),
});

export type CategorizeNextInput = z.infer<typeof categorizeNextSchema>;

export const listCategories = createServerFn({ method: "GET" })
  .validator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listCategoriesImpl } = await import("./_internal/categories");
    return listCategoriesImpl(data);
  });

export const listCategoriesWithUsage = createServerFn({ method: "GET" })
  .validator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listCategoriesWithUsageForCurrentUser } = await import(
      "./_internal/categories"
    );
    return listCategoriesWithUsageForCurrentUser(data);
  });

export const listCategoryTypes = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listCategoryTypesImpl } = await import("./_internal/categories");
    return listCategoryTypesImpl();
  }
);

export const getCategory = createServerFn({ method: "GET" })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { getCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return getCategoryForCurrentUser(data);
  });

export const createCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => categorySchema.parse(data))
  .handler(async ({ data }) => {
    const { createCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return createCategoryForCurrentUser(data);
  });

export const updateCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => categoryUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return updateCategoryForCurrentUser(data);
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { deleteCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return deleteCategoryForCurrentUser(data.id);
  });

export const setProjectCategories = createServerFn({ method: "POST" })
  .validator((data: unknown) => setProjectCategoriesSchema.parse(data))
  .handler(async ({ data }) => {
    const { setProjectCategoriesForCurrentUser } = await import(
      "./_internal/categories"
    );
    return setProjectCategoriesForCurrentUser(data);
  });

export const getProjectCategorization = createServerFn({ method: "GET" })
  .validator((data: unknown) => projectCategorizationSchema.parse(data))
  .handler(async ({ data }) => {
    const { getProjectCategorizationForCurrentUser } = await import(
      "./_internal/regenerate-categories"
    );
    return getProjectCategorizationForCurrentUser(data);
  });

export const regenerateProjectCategories = createServerFn({ method: "POST" })
  .validator((data: unknown) => projectCategorizationSchema.parse(data))
  .handler(async ({ data }) => {
    const { regenerateProjectCategoriesForCurrentUser } = await import(
      "./_internal/regenerate-categories"
    );
    return regenerateProjectCategoriesForCurrentUser(data);
  });

export const approveProposedCategory = createServerFn({ method: "POST" })
  .validator((data: unknown) => approveProposedCategorySchema.parse(data))
  .handler(async ({ data }) => {
    const { approveProposedCategoryForCurrentUser } = await import(
      "./_internal/regenerate-categories"
    );
    return approveProposedCategoryForCurrentUser(data);
  });

export const countUncategorizedProjects = createServerFn({
  method: "GET",
}).handler(async () => {
  const { countUncategorizedForCurrentUser } = await import(
    "./_internal/categorize-backfill"
  );
  return countUncategorizedForCurrentUser();
});

export const categorizeNextProject = createServerFn({ method: "POST" })
  .validator((data: unknown) => categorizeNextSchema.parse(data))
  .handler(async ({ data }) => {
    const { categorizeNextForCurrentUser } = await import(
      "./_internal/categorize-backfill"
    );
    return categorizeNextForCurrentUser(data);
  });

export const proposeCategoryCleanup = createServerFn({
  method: "POST",
}).handler(async () => {
  const { proposeCategoryCleanupForCurrentUser } = await import(
    "./_internal/category-cleanup"
  );
  return proposeCategoryCleanupForCurrentUser();
});

export const applyCategoryCleanup = createServerFn({ method: "POST" })
  .validator((data: unknown) => applyCategoryCleanupSchema.parse(data))
  .handler(async ({ data }) => {
    const { applyCategoryCleanupForCurrentUser } = await import(
      "./_internal/category-cleanup"
    );
    return applyCategoryCleanupForCurrentUser(data);
  });

export const listProjectCategories = createServerFn({ method: "GET" })
  .validator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { listProjectCategoriesImpl } = await import(
      "./_internal/categories"
    );
    return listProjectCategoriesImpl(data);
  });

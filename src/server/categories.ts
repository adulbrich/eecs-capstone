import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Room for the one sentence a description is meant to be, with slack: the
 * longest default description is under 200 characters.
 */
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 300;

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

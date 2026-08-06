import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const categorySchema = z.discriminatedUnion("domain", [
  z.object({
    domain: z.literal("project"),
    name: z.string().trim().min(1).max(100),
    type: z.string().trim().min(1).max(50),
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
  .inputValidator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { listCategoriesImpl } = await import("./_internal/categories");
    return listCategoriesImpl(data);
  });

export const listCategoryTypes = createServerFn({ method: "GET" }).handler(
  async () => {
    const { listCategoryTypesImpl } = await import("./_internal/categories");
    return listCategoryTypesImpl();
  }
);

export const getCategory = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { getCategoryImpl } = await import("./_internal/categories");
    return getCategoryImpl(data);
  });

export const createCategory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => categorySchema.parse(data))
  .handler(async ({ data }) => {
    const { createCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return createCategoryForCurrentUser(data);
  });

export const updateCategory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => categoryUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return updateCategoryForCurrentUser(data);
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data }) => {
    const { deleteCategoryForCurrentUser } = await import(
      "./_internal/categories"
    );
    return deleteCategoryForCurrentUser(data.id);
  });

export const setProjectCategories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setProjectCategoriesSchema.parse(data))
  .handler(async ({ data }) => {
    const { setProjectCategoriesForCurrentUser } = await import(
      "./_internal/categories"
    );
    return setProjectCategoriesForCurrentUser(data);
  });

export const listProjectCategories = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const { listProjectCategoriesImpl } = await import(
      "./_internal/categories"
    );
    return listProjectCategoriesImpl(data);
  });

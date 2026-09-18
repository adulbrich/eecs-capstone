import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "#/lib/pagination";
import { searchQuerySchema } from "#/lib/search-query";

/**
 * Exported so the over-length case can be tested where it actually lives.
 * The `createServerFn` wrapper below is the only caller; a test cannot
 * reach the validator through it, and `searchProjectsImpl` sees data this
 * has already clamped, so testing the impl would prove nothing about #478.
 */
export const searchInputSchema = z.object({
  query: searchQuerySchema,
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  programId: z.string().uuid().nullable().default(null),
  archivedOnly: z.boolean().default(false),
  // Off by default: hiding closed projects would make them vanish from a
  // catalog that is meant to be browsable. See #72.
  acceptingOnly: z.boolean().default(false),
  // The public mark as a filter (#336). The two mentor switches left with
  // the mentor state in #402; a URL still carrying them is stripped here.
  studentProposedOnly: z.boolean().default(false),
  // The agreement flag as a filter, the same fact as the badge (#372).
  requiresNdaOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .default(PAGE_SIZE_DEFAULT),
  /**
   * The listing's one ordering control, and the only thing that decides row
   * order in either view: the table's column headers stopped sorting in #475,
   * so there is no second ordering to disagree with this one.
   *
   * Optional rather than defaulted, so the server can tell "no choice yet"
   * from "chose relevance". An absent sort resolves in `searchProjectsImpl`,
   * which also resolves the two values that cannot always be delivered:
   * `recommended` needs an interest vector and `relevance` needs a query.
   * The resolved value comes back as `order` (#424).
   */
  sort: z
    .enum(["relevance", "newest", "oldest", "title", "updated", "recommended"])
    .optional(),
});

export type SearchProjectsInput = z.infer<typeof searchInputSchema>;

export const searchProjects = createServerFn({ method: "GET" })
  .validator((data: unknown) => searchInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchProjectsForRequest } = await import("./_internal/search");
    return searchProjectsForRequest(data);
  });

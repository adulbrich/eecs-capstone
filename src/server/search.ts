import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from "#/lib/pagination";

const searchInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
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
   * Optional rather than defaulted, so the server can tell "no choice yet"
   * from "chose relevance". An absent sort resolves in `searchProjectsImpl`:
   * a viewer with an interest vector gets `recommended`, everyone else
   * `relevance` (#424). The resolved value comes back as `order`.
   */
  sort: z.enum(["relevance", "newest", "recommended"]).optional(),
});

export type SearchProjectsInput = z.infer<typeof searchInputSchema>;

export const searchProjects = createServerFn({ method: "GET" })
  .validator((data: unknown) => searchInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchProjectsForRequest } = await import("./_internal/search");
    return searchProjectsForRequest(data);
  });

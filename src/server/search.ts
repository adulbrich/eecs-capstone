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
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE_MAX)
    .default(PAGE_SIZE_DEFAULT),
  sort: z.enum(["relevance", "newest", "recommended"]).default("relevance"),
});

export type SearchProjectsInput = z.infer<typeof searchInputSchema>;

export const searchProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => searchInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchProjectsForRequest } = await import("./_internal/search");
    return searchProjectsForRequest(data);
  });

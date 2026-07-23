import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const searchInputSchema = z.object({
  query: z.string().trim().max(200).default(""),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  programId: z.string().uuid().nullable().default(null),
  archivedOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  sort: z.enum(["relevance", "newest", "recommended"]).default("relevance"),
});

export type SearchProjectsInput = z.infer<typeof searchInputSchema>;

export const searchProjects = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => searchInputSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { searchProjectsForRequest } = await import("./_internal/search");
    return searchProjectsForRequest(data);
  });

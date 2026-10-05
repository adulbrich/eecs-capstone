import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

export type SimilarityInput = z.infer<typeof projectIdSchema>;

export const getSimilarity = createServerFn({ method: "GET" })
  .validator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { getSimilarityForCurrentUser } = await import(
      "./_internal/similarity"
    );
    return getSimilarityForCurrentUser(data);
  });

export const recomputeSimilarity = createServerFn({ method: "POST" })
  .validator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { recomputeSimilarityForCurrentUser } = await import(
      "./_internal/similarity"
    );
    return recomputeSimilarityForCurrentUser(data);
  });

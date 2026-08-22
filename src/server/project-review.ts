import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { FIELD_MAX_LENGTHS } from "#/lib/project-review-fields";

const reviewInputSchema = z.object({
  // Optional: the submission page reviews a proposal that has no row yet.
  projectId: z.string().uuid().optional(),
  fields: z.object({
    title: z.string().max(FIELD_MAX_LENGTHS.title).optional(),
    description: z.string().max(FIELD_MAX_LENGTHS.description).optional(),
    problemStatement: z
      .string()
      .max(FIELD_MAX_LENGTHS.problemStatement)
      .optional(),
    objectives: z.string().max(FIELD_MAX_LENGTHS.objectives).optional(),
    minQualifications: z
      .string()
      .max(FIELD_MAX_LENGTHS.minQualifications)
      .optional(),
    prefQualifications: z
      .string()
      .max(FIELD_MAX_LENGTHS.prefQualifications)
      .optional(),
    licenseRestrictions: z
      .string()
      .max(FIELD_MAX_LENGTHS.licenseRestrictions)
      .optional(),
  }),
});

export const reviewProject = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => reviewInputSchema.parse(data))
  .handler(async ({ data }) => {
    const { reviewProjectForCurrentUser } = await import(
      "./_internal/project-review"
    );
    return reviewProjectForCurrentUser(data);
  });

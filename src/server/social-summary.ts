import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { socialSummaryTextSchema } from "#/lib/social-summary";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

// The shared field schema, not a fourth spelling of the cap. This validator
// used to read `.max(SOCIAL_SUMMARY_MAX_LENGTH)` on the untrimmed value, which
// is a different rule from the one the seam and the panel counter applied, and
// the disagreement was invisible until a summary sat between the two (#565).
//
// `expected` is the row the panel loaded, which the save may only replace if it
// is still stored (#583). Verbatim, not through the text schema: it is compared
// with the column, so trimming or capping it would make a stored summary that
// was written some other way never match. Required, so a tab loaded before it
// existed fails its save rather than overwriting a colleague unguarded.
const saveSchema = projectIdSchema.extend({
  summary: socialSummaryTextSchema,
  expected: z.object({
    summary: z.string().nullable(),
    isManual: z.boolean(),
  }),
});

export type SocialSummaryInput = z.infer<typeof projectIdSchema>;
export type SaveSocialSummaryInput = z.infer<typeof saveSchema>;

export const getSocialSummary = createServerFn({ method: "GET" })
  .validator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { getSocialSummaryForCurrentUser } = await import(
      "./_internal/social-summary"
    );
    return getSocialSummaryForCurrentUser(data);
  });

export const saveSocialSummary = createServerFn({ method: "POST" })
  .validator((data: unknown) => saveSchema.parse(data))
  .handler(async ({ data }) => {
    const { saveSocialSummaryForCurrentUser } = await import(
      "./_internal/social-summary"
    );
    return saveSocialSummaryForCurrentUser(data);
  });

export const regenerateSocialSummary = createServerFn({ method: "POST" })
  .validator((data: unknown) => projectIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { regenerateSocialSummaryForCurrentUser } = await import(
      "./_internal/social-summary"
    );
    return regenerateSocialSummaryForCurrentUser(data);
  });

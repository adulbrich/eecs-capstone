import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SOCIAL_SUMMARY_MAX_LENGTH } from "#/lib/social-summary";

const projectIdSchema = z.object({ projectId: z.string().uuid() });

const saveSchema = projectIdSchema.extend({
  summary: z.string().min(1).max(SOCIAL_SUMMARY_MAX_LENGTH),
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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * `.trim()` before `.min(1)`, so a name of spaces is refused with the message
 * an empty one already shows, and a padded one is stored without its padding.
 * `.max(120)` measures the trimmed value for the same reason.
 *
 * The other way a name is written is sign-up, narrowed by `requireUserName` in
 * `src/lib/_internal/user-name.ts`, which says why the rule exists at all.
 */
export const profileSchema = z
  .object({
    affiliation: z.string().max(200).nullable().optional(),
    linkedin: z.string().url().max(300).nullable().optional(),
    mentorTeamCount: z.number().int().min(1).max(5).default(1),
    name: z.string().trim().min(1).max(120),
    wantsToMentor: z.boolean().default(false),
  })
  .refine((v) => !v.wantsToMentor || Boolean(v.affiliation?.trim()), {
    message: "Affiliation is required to opt in as a mentor",
    path: ["affiliation"],
  });

export type ProfileInput = z.infer<typeof profileSchema>;

export const updateProfile = createServerFn({ method: "POST" })
  .validator((data: unknown) => profileSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProfileForCurrentUser } = await import("./_internal/profile");
    return updateProfileForCurrentUser(data);
  });

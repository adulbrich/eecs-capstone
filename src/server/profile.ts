import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const profileSchema = z
  .object({
    affiliation: z.string().max(200).nullable().optional(),
    linkedin: z.string().url().max(300).nullable().optional(),
    mentorTeamCount: z.number().int().min(1).max(5).default(1),
    name: z.string().min(1).max(120),
    wantsToMentor: z.boolean().default(false),
  })
  .refine((v) => !v.wantsToMentor || Boolean(v.affiliation?.trim()), {
    message: "Affiliation is required to opt in as a mentor",
    path: ["affiliation"],
  });

export type ProfileInput = z.infer<typeof profileSchema>;

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => profileSchema.parse(data))
  .handler(async ({ data }) => {
    const { updateProfileForCurrentUser } = await import("./_internal/profile");
    return updateProfileForCurrentUser(data);
  });

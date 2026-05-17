import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { user } from "#/db/schema";
import { requireUser } from "#/lib/auth-guards.server";

const profileSchema = z.object({
  name: z.string().min(1).max(120),
  affiliation: z.string().max(200).nullable().optional(),
  linkedin: z.string().url().max(300).nullable().optional(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => profileSchema.parse(data))
  .handler(async ({ data }) => {
    const current = await requireUser();
    await db
      .update(user)
      .set({
        name: data.name,
        affiliation: data.affiliation ?? null,
        linkedin: data.linkedin ?? null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, current.id));
    return { ok: true };
  });

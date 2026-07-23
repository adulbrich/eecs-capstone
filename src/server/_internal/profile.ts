import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { ProfileInput } from "../profile";

export async function updateProfileAs(userId: string, data: ProfileInput) {
  await db
    .update(user)
    .set({
      affiliation: data.affiliation ?? null,
      linkedin: data.linkedin ?? null,
      mentorTeamCount: data.mentorTeamCount,
      name: data.name,
      updatedAt: new Date(),
      wantsToMentor: data.wantsToMentor,
    })
    .where(eq(user.id, userId));
  return { ok: true };
}

export async function updateProfileForCurrentUser(data: ProfileInput) {
  const current = await requireUser();
  return updateProfileAs(current.id, data);
}

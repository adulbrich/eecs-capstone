import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { userInterests } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import { refreshInterestsEmbedding } from "./project-embeddings";

export const INTERESTS_MAX_LENGTH = 2000;

const interestsTextSchema = z.string().trim().max(INTERESTS_MAX_LENGTH);

/** Never returns the vector itself, only whether one exists. */
export async function getMyInterestsAs(userId: string) {
  const [row] = await db
    .select({
      interestsText: userInterests.interestsText,
      embedding: userInterests.embedding,
    })
    .from(userInterests)
    .where(eq(userInterests.userId, userId));
  return {
    interestsText: row?.interestsText ?? "",
    hasEmbedding: Boolean(row?.embedding),
  };
}

export async function saveMyInterestsAs(
  userId: string,
  interestsText: string,
  embed?: EmbedFn
): Promise<{ embedded: boolean; saved: true }> {
  const text = interestsTextSchema.parse(interestsText);

  await db
    .insert(userInterests)
    .values({ userId, interestsText: text })
    .onConflictDoUpdate({
      target: userInterests.userId,
      set: { interestsText: text, updatedAt: new Date() },
    });

  const outcome = await refreshInterestsEmbedding(userId, embed);
  return {
    saved: true,
    embedded: outcome === "updated" || outcome === "unchanged",
  };
}

export async function getMyInterestsForCurrentUser() {
  const viewer = await requireUser();
  return getMyInterestsAs(viewer.id);
}

export async function saveMyInterestsForCurrentUser(interestsText: string) {
  const viewer = await requireUser();
  return saveMyInterestsAs(viewer.id, interestsText);
}

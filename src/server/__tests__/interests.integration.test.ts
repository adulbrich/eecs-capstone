import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { user, userInterests } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  getMyInterestsAs,
  saveMyInterestsAs,
} from "#/server/_internal/interests";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

async function makeUser(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u.id;
}

describe("interests", () => {
  it("returns empty state for a user who has written nothing", async () => {
    const id = await makeUser(`a-${Date.now()}@x.com`);
    expect(await getMyInterestsAs(id)).toEqual({
      interestsText: "",
      hasEmbedding: false,
    });
  });

  it("saves the text and embeds it", async () => {
    const id = await makeUser(`b-${Date.now()}@x.com`);
    const embed = vi.fn().mockResolvedValue(VECTOR);

    expect(await saveMyInterestsAs(id, "Robotics and embedded", embed)).toEqual(
      {
        saved: true,
        embedded: true,
      }
    );
    expect(await getMyInterestsAs(id)).toEqual({
      interestsText: "Robotics and embedded",
      hasEmbedding: true,
    });
  });

  it("overwrites on a second save", async () => {
    const id = await makeUser(`c-${Date.now()}@x.com`);
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await saveMyInterestsAs(id, "Robotics", embed);
    await saveMyInterestsAs(id, "Greenhouses", embed);

    const [row] = await db
      .select()
      .from(userInterests)
      .where(eq(userInterests.userId, id));
    expect(row.interestsText).toBe("Greenhouses");
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("saves the text but reports embedded:false when Bedrock fails", async () => {
    const id = await makeUser(`d-${Date.now()}@x.com`);
    const embed = vi.fn().mockRejectedValue(new Error("down"));

    expect(await saveMyInterestsAs(id, "Robotics", embed)).toEqual({
      saved: true,
      embedded: false,
    });
    expect((await getMyInterestsAs(id)).interestsText).toBe("Robotics");
    expect((await getMyInterestsAs(id)).hasEmbedding).toBe(false);
  });

  it("nulls the stale vector when interests are cleared", async () => {
    const id = await makeUser(`g-${Date.now()}@x.com`);
    const embed = vi.fn().mockResolvedValue(VECTOR);

    expect(await saveMyInterestsAs(id, "Robotics", embed)).toEqual({
      saved: true,
      embedded: true,
    });
    expect((await getMyInterestsAs(id)).hasEmbedding).toBe(true);

    expect(await saveMyInterestsAs(id, "", embed)).toEqual({
      saved: true,
      embedded: false,
    });

    const [row] = await db
      .select()
      .from(userInterests)
      .where(eq(userInterests.userId, id));
    expect(row.embedding).toBeNull();
    expect(row.embeddingSourceHash).toBeNull();
    expect(await getMyInterestsAs(id)).toEqual({
      interestsText: "",
      hasEmbedding: false,
    });
  });

  it("rejects text over the length limit", async () => {
    const id = await makeUser(`e-${Date.now()}@x.com`);
    await expect(saveMyInterestsAs(id, "x".repeat(2001))).rejects.toThrow();
  });

  it("is removed when the user is deleted", async () => {
    const id = await makeUser(`f-${Date.now()}@x.com`);
    await saveMyInterestsAs(id, "Robotics", vi.fn().mockResolvedValue(VECTOR));
    await db.delete(user).where(eq(user.id, id));

    const rows = await db
      .select()
      .from(userInterests)
      .where(eq(userInterests.userId, id));
    expect(rows.length).toBe(0);
  });
});

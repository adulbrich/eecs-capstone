import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { deleteAccountAs } from "#/server/_internal/account";

// Its own file because the mock is module-wide: every other account test
// wants the real storage client, and a client that fails every call would
// turn their avatar cleanup into warnings nobody reads.
//
// The S3 client is what fails, not the storage module's exports: the real
// `deleteOwnedObject` has to run, since its swallow is the behaviour under
// test, and it calls `getObjectStorage` through the module's own binding,
// which a mocked export would not reach.
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class DownS3Client {
    send() {
      return Promise.reject(new Error("S3 is down"));
    }
  }
  return { ...original, S3Client: DownS3Client };
});

describe("deleteAccountAs when the avatar object cannot be deleted", () => {
  it("still scrubs the account: an orphaned object beats a half-deleted person", async () => {
    const email = `dsx-${Date.now()}@x.com`;
    await auth.api.signUpEmail({
      body: { email, password: "Password1!", name: "Has Avatar" },
    });
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.email, email));
    const [u] = await db.select().from(user).where(eq(user.email, email));
    const image = `avatars/${u.id}/current.webp`;
    await db.update(user).set({ image }).where(eq(user.id, u.id));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await deleteAccountAs({ id: u.id, role: u.role }, { confirmEmail: email });

    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.name).toBe("Deleted user");
    expect(row.image).toBeNull();
    expect(row.deletedAt).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to delete object ${image}`),
      expect.any(Error)
    );
    warn.mockRestore();
  });
});

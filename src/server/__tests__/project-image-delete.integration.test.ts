import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
import {
  createProjectAs,
  forceTransitionAs,
  updateProjectAs,
} from "#/server/_internal/projects";

// Its own file because the mock is module-wide, for the reason
// `account-storage.integration.test.ts` gives: the real `deleteOwnedObject`
// has to run, and it reaches the client through the module's own binding.
//
// A `send` that never settles and ignores its abort signal, so nothing but
// the caller declining to wait can let the save answer. This proves the save
// does not await the delete (#621); `storage-timeouts.test.ts` proves the
// bound on the call itself.
const { sent } = vi.hoisted(() => ({ sent: [] as unknown[] }));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class StalledS3Client {
    send(command: unknown) {
      sent.push(command);
      return new Promise(() => undefined);
    }
  }
  return { ...original, S3Client: StalledS3Client };
});

const embed = vi.fn().mockResolvedValue(new Array(1024).fill(0.1));

afterEach(async () => {
  await settleProjectRefreshes();
  sent.length = 0;
});

async function makeAdmin() {
  const email = `pid-${Date.now()}@x.com`;
  await auth.api.createUser({ body: { email, name: email } });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role, email: u.email, name: u.name };
}

function baseProject() {
  return {
    title: "P",
    description: null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    notes: null,
    teamsSupported: 1,
  };
}

const NEVER = Symbol("the save did not answer");

describe("updateProjectAs when the old image's delete never settles", () => {
  it("still answers, with the new key committed and the delete started", async () => {
    const admin = await makeAdmin();
    const { id } = await createProjectAs(admin, baseProject());
    await forceTransitionAs(admin, id, "published", undefined, {
      embed,
      sendEmail: false,
    });
    const oldKey = `projects/${id}/old.webp`;
    const newKey = `projects/${id}/new.webp`;
    await db
      .update(projects)
      .set({ imageUrl: oldKey })
      .where(eq(projects.id, id));

    const answer = await Promise.race([
      updateProjectAs(admin, { ...baseProject(), id, imageUrl: newKey }, embed),
      new Promise((resolve) => setTimeout(() => resolve(NEVER), 5000)),
    ]);

    expect(answer).toEqual({ id, updated: true });
    const [row] = await db
      .select({ imageUrl: projects.imageUrl })
      .from(projects)
      .where(eq(projects.id, id));
    expect(row.imageUrl).toBe(newKey);
    // Started before the save answered, and still pending: the only S3 call
    // is the delete of the key the row stopped pointing at.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((sent[0] as DeleteObjectCommand).input.Key).toBe(oldKey);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { createProjectAs } from "#/server/_internal/projects";
import {
  clearAvatarAs,
  uploadAvatarAs,
  uploadProjectImageAs,
} from "#/server/_internal/uploads";

const fixture = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "lib",
    "__tests__",
    "fixtures",
    "sample.jpg"
  )
);

function s3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });
}

async function makeUser(email: string, role: "user" | "admin" = "user") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u;
}

function fakeFile(name: string, bytes: Buffer, type = "image/jpeg") {
  if (typeof File !== "undefined") {
    return new File([new Uint8Array(bytes)], name, { type });
  }
  throw new Error("File constructor not available");
}

describe("uploadProjectImageAs", () => {
  it("writes to the bucket and updates the project row", async () => {
    const admin = await makeUser(`u-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: projectId } = await createProjectAs(viewer, {
      title: "test",
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
      programId: null,
      notes: null,
    });

    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", fakeFile("sample.jpg", fixture));

    const result = await uploadProjectImageAs(viewer, form);
    expect(result.key).toMatch(new RegExp(`^projects/${projectId}/.+\\.webp$`));

    const client = s3Client();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET ?? "cs-capstone",
        Key: result.key,
      })
    );
    expect(head.ContentType).toBe("image/webp");
    expect(head.ContentLength).toBeGreaterThan(0);

    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(row.imageUrl).toBe(result.key);
  });
});

describe("uploadAvatarAs", () => {
  // This block was `describe.skip` with a placeholder, because requireUser()
  // inside the implementation needed a request context the harness does not
  // provide. Splitting out the *As seam is what makes it runnable, which is
  // the whole reason the convention exists.
  it("writes to the bucket and updates the user row", async () => {
    const u = await makeUser(`av-${Date.now()}@x.com`, "user");
    const viewer = { id: u.id, role: u.role, image: null };

    const form = new FormData();
    form.append("file", fakeFile("sample.jpg", fixture));

    const result = await uploadAvatarAs(viewer, form);
    expect(result.key).toMatch(new RegExp(`^avatars/${u.id}/.+\\.webp$`));

    const client = s3Client();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET ?? "cs-capstone",
        Key: result.key,
      })
    );
    expect(head.ContentType).toBe("image/webp");

    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.image).toBe(result.key);
  });

  it("refuses a file that is not an allowed image", async () => {
    const u = await makeUser(`ax-${Date.now()}@x.com`, "user");
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("not an image")], "x.txt", { type: "text/plain" })
    );
    await expect(
      uploadAvatarAs({ id: u.id, role: u.role, image: null }, form)
    ).rejects.toThrow(/Unsupported image type/);
  });
});

describe("clearAvatarAs", () => {
  it("nulls the column", async () => {
    const u = await makeUser(`ac-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ image: "avatars/whatever.webp" })
      .where(eq(user.id, u.id));

    await clearAvatarAs({
      id: u.id,
      role: u.role,
      image: "avatars/whatever.webp",
    });

    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.image).toBeNull();
  });

  it("is a no-op for a viewer who has no avatar", async () => {
    // The storage delete is skipped entirely rather than called with null.
    const u = await makeUser(`ad-${Date.now()}@x.com`, "user");
    await expect(
      clearAvatarAs({ id: u.id, role: u.role, image: null })
    ).resolves.toEqual({ ok: true });
  });
});

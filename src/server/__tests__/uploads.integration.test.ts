import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { createProjectAs, updateProjectAs } from "#/server/_internal/projects";
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

function baseProject() {
  return {
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
  };
}

describe("uploadProjectImageAs", () => {
  it("writes to the bucket and deliberately leaves the row alone", async () => {
    const admin = await makeUser(`u-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: projectId } = await createProjectAs(viewer, baseProject());

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

    // The row is deliberately untouched. The caller passes the returned key
    // into updateProject, which is what puts the change in the edit log and
    // what makes a failed upload leave nothing half saved. See #88.
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(row.imageUrl).toBeNull();
  });

  it("refuses a file that is not an allowed image", async () => {
    const admin = await makeUser(`u-rej-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: projectId } = await createProjectAs(viewer, baseProject());
    await db
      .update(projects)
      .set({ imageUrl: "projects/original.webp", title: "before" })
      .where(eq(projects.id, projectId));

    const form = new FormData();
    form.append("projectId", projectId);
    form.append(
      "file",
      new File([Buffer.from("not an image")], "x.txt", { type: "text/plain" })
    );
    await expect(uploadProjectImageAs(viewer, form)).rejects.toThrow(
      /Unsupported image type/
    );

    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(row.imageUrl).toBe("projects/original.webp");
    expect(row.title).toBe("before");
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

const BUCKET = process.env.S3_BUCKET ?? "cs-capstone";

async function putObject(key: string) {
  await s3Client().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "x" })
  );
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3Client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

describe("updateProjectAs image cleanup", () => {
  it("deletes the object its own key replaced", async () => {
    const admin = await makeUser(`cl-a-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id } = await createProjectAs(viewer, baseProject());
    const oldKey = `projects/${id}/old.webp`;
    await putObject(oldKey);
    await updateProjectAs(viewer, { id, ...baseProject(), imageUrl: oldKey });

    await updateProjectAs(viewer, {
      id,
      ...baseProject(),
      imageUrl: `projects/${id}/new.webp`,
    });

    expect(await objectExists(oldKey)).toBe(false);
  });

  it("leaves a key outside the project's own prefix alone", async () => {
    // imageUrl is a client-writable column, so a caller can point their own
    // project at another project's key. Without the prefix guard the next save
    // deletes that object, and the other project's image is gone from storage
    // rather than merely unlinked. An orphan is the cheaper failure.
    const admin = await makeUser(`cl-b-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: victimId } = await createProjectAs(viewer, baseProject());
    const { id: attackerId } = await createProjectAs(viewer, baseProject());
    const victimKey = `projects/${victimId}/victim.webp`;
    await putObject(victimKey);

    await updateProjectAs(viewer, {
      id: attackerId,
      ...baseProject(),
      imageUrl: victimKey,
    });
    await updateProjectAs(viewer, {
      id: attackerId,
      ...baseProject(),
      imageUrl: `projects/${attackerId}/mine.webp`,
    });

    expect(await objectExists(victimKey)).toBe(true);
  });
});

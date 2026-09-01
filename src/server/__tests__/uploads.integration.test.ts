import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  hardDeleteProjectAs,
  updateProjectAs,
} from "#/server/_internal/projects";
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

const BUCKET = process.env.S3_BUCKET ?? "cs-capstone";

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
        Bucket: BUCKET,
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

/**
 * A project whose image exists in both the row and the bucket.
 *
 * The column is set with a direct update rather than through
 * `updateProjectAs`, matching the sibling test above: this test is about the
 * upload guard, and routing its setup through another seam would let a
 * regression there fail this test for an unrelated reason.
 */
async function seededProject(owner: { id: string; role: string | null }) {
  const { id } = await createProjectAs(owner, baseProject());
  const key = `projects/${id}/original.webp`;
  await db.update(projects).set({ imageUrl: key }).where(eq(projects.id, id));
  await s3Client().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "x" })
  );
  return id;
}

describe("uploadProjectImageAs cross-user guard", () => {
  it("refuses a signed-in viewer who is neither proposer nor staff", async () => {
    // #155 asked for two assertions here: that the project's imageUrl still
    // points at the original key, and that the old S3 object still exists.
    // Both described this seam as it was, when it wrote the column and deleted
    // the key it replaced, so a stranger's upload destroyed the original. #88
    // moved those two behaviours to `updateProjectAs`; what is left here
    // stores an object and returns its key.
    //
    // The project therefore starts with an image in both places, and both of
    // #155's assertions are made below against that starting state.
    const owner = await makeUser(`g-o-${Date.now()}@x.com`, "user");
    const stranger = await makeUser(`g-s-${Date.now()}@x.com`, "user");
    const projectId = await seededProject(owner);
    const originalKey = `projects/${projectId}/original.webp`;

    const form = new FormData();
    form.append("projectId", projectId);
    form.append("file", fakeFile("sample.jpg", fixture));

    await expect(
      uploadProjectImageAs({ id: stranger.id, role: stranger.role }, form)
    ).rejects.toThrow(/Forbidden/);

    // `uploadProjectImageAs` only selects the row; it has written none since
    // #88.
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(row.imageUrl).toBe(originalKey);

    // Listed rather than headed, because a stranger's key would be a uuid no
    // caller could name in advance.
    const listed = await s3Client().send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `projects/${projectId}/`,
      })
    );
    expect(listed.Contents?.map((o) => o.Key)).toEqual([originalKey]);
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
        Bucket: BUCKET,
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
    // Defence in depth behind the write guard below: a row that already holds
    // another project's key, however it got there, must not take that object
    // down on the next save. An orphan is the cheaper failure. The bad value
    // is seeded with a raw update because the write guard refuses it.
    const admin = await makeUser(`cl-b-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: victimId } = await createProjectAs(viewer, baseProject());
    const { id: attackerId } = await createProjectAs(viewer, baseProject());
    const victimKey = `projects/${victimId}/victim.webp`;
    await putObject(victimKey);
    await db
      .update(projects)
      .set({ imageUrl: victimKey })
      .where(eq(projects.id, attackerId));

    await updateProjectAs(viewer, {
      id: attackerId,
      ...baseProject(),
      imageUrl: `projects/${attackerId}/mine.webp`,
    });

    expect(await objectExists(victimKey)).toBe(true);
  });
});

describe("what imageUrl may be set to", () => {
  it("refuses a third-party URL", async () => {
    // The point of the whole guard: without it any signed-in user can make
    // every viewer of their project, a reviewing staff member above all,
    // fetch a URL the proposer controls. See #162.
    const admin = await makeUser(`iu-a-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id } = await createProjectAs(viewer, baseProject());

    await expect(
      updateProjectAs(viewer, {
        id,
        ...baseProject(),
        imageUrl: "https://example.com/x.png",
      })
    ).rejects.toThrow("Invalid image");
  });

  it("refuses a key under another project's prefix", async () => {
    const admin = await makeUser(`iu-b-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: victimId } = await createProjectAs(viewer, baseProject());
    const { id } = await createProjectAs(viewer, baseProject());

    await expect(
      updateProjectAs(viewer, {
        id,
        ...baseProject(),
        imageUrl: `projects/${victimId}/victim.webp`,
      })
    ).rejects.toThrow("Invalid image");
  });

  it("refuses a traversal out of its own prefix", async () => {
    // `startsWith` alone would pass this. It is a distinct key in S3, so it
    // destroys nothing, but a browser normalizes the path it renders into.
    const admin = await makeUser(`iu-c-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: victimId } = await createProjectAs(viewer, baseProject());
    const { id } = await createProjectAs(viewer, baseProject());

    await expect(
      updateProjectAs(viewer, {
        id,
        ...baseProject(),
        imageUrl: `projects/${id}/../${victimId}/victim.webp`,
      })
    ).rejects.toThrow("Invalid image");
  });

  it("accepts a key under its own prefix, and accepts clearing it", async () => {
    const admin = await makeUser(`iu-d-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id } = await createProjectAs(viewer, baseProject());

    await updateProjectAs(viewer, {
      id,
      ...baseProject(),
      imageUrl: `projects/${id}/mine.webp`,
    });
    await updateProjectAs(viewer, { id, ...baseProject(), imageUrl: "" });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.imageUrl).toBeNull();
  });

  it("still lets a row holding a legacy absolute URL be edited", async () => {
    // The guard is on CHANGE, not on content. Real rows hold absolute URLs
    // (the dev seed writes Unsplash links) and the edit form round-trips the
    // field, so checking content would make those rows uneditable.
    const admin = await makeUser(`iu-e-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id } = await createProjectAs(viewer, baseProject());
    const legacy = "https://images.unsplash.com/photo-123";
    await db
      .update(projects)
      .set({ imageUrl: legacy })
      .where(eq(projects.id, id));

    await updateProjectAs(viewer, {
      id,
      ...baseProject(),
      title: "edited",
      imageUrl: legacy,
    });

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.title).toBe("edited");
    expect(row.imageUrl).toBe(legacy);
  });

  it("refuses any imageUrl on create, where no key can exist yet", async () => {
    // Guarding only the edit path is bypassed by never editing.
    const admin = await makeUser(`iu-f-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };

    await expect(
      createProjectAs(viewer, {
        ...baseProject(),
        imageUrl: "https://example.com/x.png",
      })
    ).rejects.toThrow("Invalid image");
  });
});

describe("hardDeleteProjectAs image cleanup", () => {
  it("deletes the object the vanished row pointed at", async () => {
    const admin = await makeUser(`hd-a-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id } = await createProjectAs(viewer, baseProject());
    const key = `projects/${id}/only.webp`;
    await putObject(key);
    await updateProjectAs(viewer, { id, ...baseProject(), imageUrl: key });

    await hardDeleteProjectAs(viewer, id);

    expect(await objectExists(key)).toBe(false);
  });

  it("leaves a key outside the project's own prefix alone", async () => {
    // Same reasoning as the update path: a row pointed at someone else's key
    // must not take that object down with it. An orphan is the cheaper
    // failure. The bad value goes in with a raw update so the case survives
    // whatever the write path comes to allow.
    const admin = await makeUser(`hd-b-${Date.now()}@x.com`, "admin");
    const viewer = { id: admin.id, role: admin.role };
    const { id: victimId } = await createProjectAs(viewer, baseProject());
    const { id: attackerId } = await createProjectAs(viewer, baseProject());
    const victimKey = `projects/${victimId}/victim.webp`;
    await putObject(victimKey);
    await db
      .update(projects)
      .set({ imageUrl: victimKey })
      .where(eq(projects.id, attackerId));

    await hardDeleteProjectAs(viewer, attackerId);

    expect(await objectExists(victimKey)).toBe(true);
  });
});

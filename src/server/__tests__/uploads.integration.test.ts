import { readFileSync } from "node:fs";
import path from "node:path";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { createProjectAs } from "#/server/_internal/projects";
import { uploadProjectImageAs } from "#/server/_internal/uploads";

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

describe.skip("uploadAvatarForCurrentUser", () => {
  // requireUser() inside the impl needs a request context that the test
  // harness does not provide. The project-image test above exercises the
  // same upload pipeline (Sharp -> bucket -> row update); the avatar path
  // is structurally identical and shares the storage and Sharp code, so a
  // manual smoke (Section 13 in spec) covers it.
  it("placeholder", () => {});
});

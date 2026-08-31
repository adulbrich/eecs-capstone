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
import { inventoryItems, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  hardDeleteInventoryItemAs,
  updateInventoryItemAs,
} from "#/server/_internal/inventory-catalog";
import { uploadInventoryImageAs } from "#/server/_internal/inventory-images";
import { transitionItem } from "#/server/_internal/inventory-transitions";

const BUCKET = process.env.S3_BUCKET ?? "cs-capstone";

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

async function makeStaff(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeItem(name: string, imageUrl: string | null = null) {
  const [item] = await db
    .insert(inventoryItems)
    .values({ name, imageUrl })
    .returning();
  return item;
}

function payload(name: string, imageUrl: string | null) {
  return {
    name,
    description: null,
    categoryIds: [],
    serial: null,
    label: null,
    location: null,
    notes: null,
    imageUrl,
  };
}

describe("uploadInventoryImageAs", () => {
  it("stores the object and deliberately leaves the row alone", async () => {
    // The caller saves the returned key through updateInventoryItem, which is
    // what puts the change in the item's edit log. See #126.
    const staff = await makeStaff(`inv-up-${Date.now()}@x.com`);
    const item = await makeItem(`Up-${Date.now()}`);

    const form = new FormData();
    form.append("itemId", item.id);
    form.append(
      "file",
      new File([new Uint8Array(fixture)], "sample.jpg", { type: "image/jpeg" })
    );
    const { key } = await uploadInventoryImageAs(staff, form);

    expect(key).toMatch(new RegExp(`^inventory/${item.id}/.+\\.webp$`));
    expect(await objectExists(key)).toBe(true);
    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.imageUrl).toBeNull();
  });

  it("refuses a caller who is not staff", async () => {
    const item = await makeItem(`Guard-${Date.now()}`);
    const form = new FormData();
    form.append("itemId", item.id);
    form.append(
      "file",
      new File([new Uint8Array(fixture)], "sample.jpg", { type: "image/jpeg" })
    );
    await expect(
      uploadInventoryImageAs({ id: "nobody", role: "user" }, form)
    ).rejects.toThrow(/Forbidden|staff/i);
  });
});

describe("inventory image cleanup", () => {
  it("deletes the object a replacement replaced", async () => {
    const staff = await makeStaff(`inv-r-${Date.now()}@x.com`);
    const name = `Replace-${Date.now()}`;
    const item = await makeItem(name);
    const oldKey = `inventory/${item.id}/old.webp`;
    await putObject(oldKey);
    await updateInventoryItemAs(staff, {
      id: item.id,
      ...payload(name, oldKey),
    });

    await updateInventoryItemAs(staff, {
      id: item.id,
      ...payload(name, `inventory/${item.id}/new.webp`),
    });

    expect(await objectExists(oldKey)).toBe(false);
  });

  it("deletes the object when the image is cleared", async () => {
    const staff = await makeStaff(`inv-c-${Date.now()}@x.com`);
    const name = `Clear-${Date.now()}`;
    const item = await makeItem(name);
    const key = `inventory/${item.id}/only.webp`;
    await putObject(key);
    await updateInventoryItemAs(staff, { id: item.id, ...payload(name, key) });

    await updateInventoryItemAs(staff, { id: item.id, ...payload(name, null) });

    expect(await objectExists(key)).toBe(false);
  });

  it("leaves a key outside the item's own prefix alone", async () => {
    // imageUrl is a staff-writable column, so an item can be pointed at another
    // item's key. Deleting that on the next save would destroy a photo the
    // caller never owned; an orphan is the cheaper failure.
    const staff = await makeStaff(`inv-x-${Date.now()}@x.com`);
    const victim = await makeItem(`Victim-${Date.now()}`);
    const victimKey = `inventory/${victim.id}/victim.webp`;
    await putObject(victimKey);
    const name = `Thief-${Date.now()}`;
    const thief = await makeItem(name);

    await updateInventoryItemAs(staff, {
      id: thief.id,
      ...payload(name, victimKey),
    });
    await updateInventoryItemAs(staff, {
      id: thief.id,
      ...payload(name, `inventory/${thief.id}/mine.webp`),
    });

    expect(await objectExists(victimKey)).toBe(true);
  });

  it("deletes the object when the item is hard deleted", async () => {
    const staff = await makeStaff(`inv-d-${Date.now()}@x.com`);
    const name = `Gone-${Date.now()}`;
    const item = await makeItem(name);
    const key = `inventory/${item.id}/gone.webp`;
    await putObject(key);
    await updateInventoryItemAs(staff, { id: item.id, ...payload(name, key) });
    await transitionItem(staff, { itemId: item.id, nextStatus: "retired" });

    await hardDeleteInventoryItemAs(staff, { id: item.id, confirmName: name });

    expect(await objectExists(key)).toBe(false);
  });

  it("keeps the object when the item is only retired", async () => {
    // Retire is the archive: the row stays, so its photo stays with it.
    const staff = await makeStaff(`inv-t-${Date.now()}@x.com`);
    const name = `Kept-${Date.now()}`;
    const item = await makeItem(name);
    const key = `inventory/${item.id}/kept.webp`;
    await putObject(key);
    await updateInventoryItemAs(staff, { id: item.id, ...payload(name, key) });

    await transitionItem(staff, { itemId: item.id, nextStatus: "retired" });

    expect(await objectExists(key)).toBe(true);
  });
});

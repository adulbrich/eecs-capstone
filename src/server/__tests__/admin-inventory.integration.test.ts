import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { inventoryItems, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { listAdminInventoryAs } from "#/server/_internal/inventory";

async function makeAdmin(email: string) {
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

async function makeHolder(email: string, name: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name },
  });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u.id;
}

const EMPTY = { category: null, q: "", status: null } as const;

describe("listAdminInventoryAs", () => {
  it("returns every matching row rather than one page", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values(Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}` })));
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows).toHaveLength(25);
  });

  it("excludes retired items", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ name: "Live" }, { name: "Gone", status: "retired" }]);
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows.map((r) => r.name)).toEqual(["Live"]);
  });

  it("finds an item by its serial", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db.insert(inventoryItems).values([
      { name: "Oscilloscope", serial: "SN-99812" },
      { name: "Multimeter", serial: "SN-11111" },
    ]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "99812",
    });
    expect(rows.map((r) => r.name)).toEqual(["Oscilloscope"]);
  });

  it("finds an item by its asset label", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ label: "CS-0042", name: "Soldering iron" }]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "CS-0042",
    });
    expect(rows.map((r) => r.name)).toEqual(["Soldering iron"]);
  });

  it("finds an item by its location", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ location: "Kelley 3068", name: "Robot arm" }]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "Kelley",
    });
    expect(rows.map((r) => r.name)).toEqual(["Robot arm"]);
  });

  it("finds an item by who is holding it", async () => {
    const admin = await makeAdmin("admin@example.edu");
    const holderId = await makeHolder("dana@example.edu", "Dana Reyes");
    await db
      .insert(inventoryItems)
      .values([
        { currentHolderId: holderId, name: "Tripod" },
        { name: "Backdrop" },
      ]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "dana@example.edu",
    });
    expect(rows.map((r) => r.name)).toEqual(["Tripod"]);
  });

  it("carries the timestamps the table sorts by", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db.insert(inventoryItems).values([{ name: "Camera" }]);
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("refuses a non-staff viewer", async () => {
    const holderId = await makeHolder("student@example.edu", "Student");
    await expect(
      listAdminInventoryAs({ id: holderId, role: "user" }, EMPTY)
    ).rejects.toThrow("Forbidden");
  });
});

describe("public inventory search stays narrow", () => {
  it("does not match a staff-only serial", async () => {
    const { listInventoryAs } = await import("#/server/_internal/inventory");
    await db
      .insert(inventoryItems)
      .values([{ name: "Oscilloscope", serial: "SN-99812" }]);
    const { rows } = await listInventoryAs(null, {
      category: null,
      page: 1,
      pageSize: 24,
      q: "99812",
      status: null,
    });
    expect(rows).toHaveLength(0);
  });
});

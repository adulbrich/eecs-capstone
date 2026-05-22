import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  inventoryItemEditLog,
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createInventoryItemAs,
  getInventoryItemAs,
  hardDeleteInventoryItemAs,
  listInventoryAs,
  updateInventoryItemAs,
} from "#/server/_internal/inventory";
import { transitionItem } from "#/server/_internal/inventory-transitions";

async function makeUser(
  email: string,
  role: "user" | "admin" | "instructor",
) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeItem(overrides: Partial<typeof inventoryItems.$inferInsert> = {}) {
  const [item] = await db
    .insert(inventoryItems)
    .values({ name: `Item-${Date.now()}-${Math.random()}`, ...overrides })
    .returning();
  return item;
}

async function makeRequestLine(userId: string, itemId: string) {
  const [req] = await db
    .insert(inventoryRequests)
    .values({ userId })
    .returning();
  const [line] = await db
    .insert(inventoryRequestItems)
    .values({ requestId: req.id, itemId, status: "pending" })
    .returning();
  return { req, line };
}

describe("transitionItem", () => {
  it("staff-only: non-staff viewer is rejected", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(student, {
        itemId: item.id,
        nextStatus: "maintenance",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("available to maintenance writes history and clears holder columns", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
      comment: "needs new cable",
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("maintenance");
    expect(after.currentHolderId).toBeNull();
    expect(after.currentRequestItemId).toBeNull();
    const history = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(history).toHaveLength(1);
    expect(history[0].oldStatus).toBe("available");
    expect(history[0].newStatus).toBe("maintenance");
    expect(history[0].comment).toBe("needs new cable");
  });

  it("reserved transition requires requestItemId + exactly one holder", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await expect(
      transitionItem(admin, { itemId: item.id, nextStatus: "reserved" }),
    ).rejects.toThrow(/requestItemId/);
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const { line } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: student.id,
        holderLabel: "X",
      }),
    ).rejects.toThrow(/exactly one of holderId or holderLabel/);
  });

  it("reserved transition updates line to approved + sets pickupBy + notifies", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    const pickupBy = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy,
    });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("approved");
    expect(reqLine.pickupBy?.getTime()).toBe(pickupBy.getTime());
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_approved"),
    ).toBe(true);
  });

  it("checked_out requires dueAt", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "checked_out",
        requestItemId: line.id,
        holderId: student.id,
      }),
    ).rejects.toThrow(/dueAt/);
  });

  it("ad-hoc label: checked_out with holderLabel and no holderId", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderLabel: "Course demo",
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBeNull();
    expect(after.currentHolderLabel).toBe("Course demo");
  });

  it("releasing a reserved item back to available closes the line as cancelled (released before fulfillment)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("cancelled");
    expect(reqLine.closedBy).toBe(admin.id);
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBeNull();
    expect(after.currentRequestItemId).toBeNull();
  });

  it("checked-out item returned to available closes the line as returned (fulfillment completed)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("returned");
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_item_returned"),
    ).toBe(true);
  });

  it("released reserved item to retired notifies requester with inventory_request_closed", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "retired",
      comment: "no longer in service",
    });
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_closed"),
    ).toBe(true);
  });

  it("rejects requested transition when item is not available (overwrite guard)", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line: line1 } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "requested",
      requestItemId: line1.id,
      holderId: student.id,
    });
    const { line: line2 } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "requested",
        requestItemId: line2.id,
        holderId: student.id,
      }),
    ).rejects.toThrow(/Cannot move item to requested/);
  });
});

describe("listInventoryAs privacy", () => {
  it("strips holder + notes + serial for anonymous viewer", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({
      notes: "internal note",
      serial: "SN-001",
    });
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    const result = await listInventoryAs(null, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id)!;
    expect(found).toBeDefined();
    expect("notes" in found).toBe(false);
    expect("serial" in found).toBe(false);
    expect("currentHolderId" in found).toBe(false);
  });

  it("includes notes + holder for staff viewer", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "internal" });
    const result = await listInventoryAs(admin, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id);
    expect(found).toBeDefined();
    expect((found as unknown as { notes: string }).notes).toBe("internal");
  });

  it("hides retired items from non-staff list and detail", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    const anonList = await listInventoryAs(null, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    expect(anonList.rows.some((r) => r.id === item.id)).toBe(false);
    const anonDetail = await getInventoryItemAs(null, { id: item.id });
    expect(anonDetail).toBeNull();
    const staffDetail = await getInventoryItemAs(admin, { id: item.id });
    expect(staffDetail?.status).toBe("retired");
  });
});

describe("catalog CRUD", () => {
  it("non-staff cannot create / update / delete", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const blank = {
      name: "X",
      description: null,
      category: null,
      serial: null,
      location: null,
      notes: null,
      imageUrl: null,
    };
    await expect(createInventoryItemAs(student, blank)).rejects.toThrow(
      /Forbidden/,
    );
    await expect(
      updateInventoryItemAs(student, { id: "00000000-0000-0000-0000-000000000000", ...blank }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      hardDeleteInventoryItemAs(student, {
        id: "00000000-0000-0000-0000-000000000000",
        confirmName: "X",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("update writes one edit-log row with diffed fields", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Old", location: "Shelf A" });
    await updateInventoryItemAs(admin, {
      id: item.id,
      name: "New",
      description: null,
      category: null,
      serial: null,
      location: "Shelf B",
      notes: null,
      imageUrl: null,
    });
    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, item.id));
    expect(logs).toHaveLength(1);
    expect(new Set(logs[0].changedFields)).toEqual(
      new Set(["name", "location"]),
    );
    expect(logs[0].oldValues).toMatchObject({ name: "Old", location: "Shelf A" });
    expect(logs[0].newValues).toMatchObject({ name: "New", location: "Shelf B" });
  });

  it("hard-delete refuses when status is checked_out", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Scope" });
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86400000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Scope" }),
    ).rejects.toThrow(/available or retired/);
  });

  it("hard-delete refuses when name confirmation does not match", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Real" });
    // Retire first so the status gate cannot fire instead and mask a name-gate bug.
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Wrong" }),
    ).rejects.toThrow(/confirmation/);
  });

  it("hard-delete succeeds when retired and unused", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Old kit" });
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await hardDeleteInventoryItemAs(admin, {
      id: item.id,
      confirmName: "Old kit",
    });
    const found = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(found).toHaveLength(0);
  });

  it("hard-delete fails when historical request lines reference the item", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Cabled" });
    await makeRequestLine(student.id, item.id); // pending, never resolved
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Cabled" }),
    ).rejects.toThrow(/historical/i);
  });
});

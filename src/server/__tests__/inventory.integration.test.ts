import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  inventoryCartItems,
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
  addToCartAs,
  approveRequestItemAs,
  cancelRequestItemAs,
  createInventoryItemAs,
  getInventoryItemAs,
  hardDeleteInventoryItemAs,
  listInventoryAs,
  recordOverdueNotificationsAs,
  rejectRequestItemAs,
  submitCartAs,
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

describe("cart", () => {
  it("rejects adding a non-available item", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });
    await expect(
      addToCartAs(student, { itemId: item.id }),
    ).rejects.toThrow(/available/);
  });

  it("submit happy path: one request, N lines, items move to requested", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const items = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of items) await addToCartAs(student, { itemId: i.id });
    const result = await submitCartAs(student, { note: "for demo" });
    expect(result.submitted).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    for (const i of items) {
      const [row] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, i.id));
      expect(row.status).toBe("requested");
      expect(row.currentHolderId).toBe(student.id);
      expect(row.currentRequestItemId).not.toBeNull();
    }
    const cartLeft = await db
      .select()
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, student.id));
    expect(cartLeft).toHaveLength(0);
  });

  it("submit partial: skips items that became unavailable between add and submit", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const [a, b, c] = await Promise.all([makeItem(), makeItem(), makeItem()]);
    await addToCartAs(student, { itemId: a.id });
    await addToCartAs(student, { itemId: b.id });
    await addToCartAs(student, { itemId: c.id });
    await transitionItem(admin, { itemId: b.id, nextStatus: "maintenance" });
    const result = await submitCartAs(student, { note: null });
    expect(result.submitted.sort()).toEqual([a.id, c.id].sort());
    expect(result.skipped).toEqual([
      { itemId: b.id, reason: "no_longer_available" },
    ]);
    const cartLeft = await db
      .select()
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, student.id));
    expect(cartLeft).toHaveLength(0);
  });
});

describe("request lifecycle", () => {
  it("approve moves item to reserved + line to approved + notifies", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Scope" });
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("reserved");
    const [reqLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(reqLine.status).toBe("approved");
    expect(reqLine.pickupBy).not.toBeNull();
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(
      notifs.some((n) => n.type === "inventory_request_approved"),
    ).toBe(true);
  });

  it("reject requires reason and returns item to available", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await expect(
      rejectRequestItemAs(admin, {
        requestItemId: line.id,
        reviewComment: "",
      }),
    ).rejects.toThrow(/required/);
    await rejectRequestItemAs(admin, {
      requestItemId: line.id,
      reviewComment: "Reserved for class",
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("available");
    expect(after.currentHolderId).toBeNull();
    const [afterLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(afterLine.status).toBe("rejected");
    expect(afterLine.reviewComment).toBe("Reserved for class");
  });

  it("cancel works while pending or reserved, blocked after checkout", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const a = await makeItem();
    const b = await makeItem();
    await addToCartAs(student, { itemId: a.id });
    await addToCartAs(student, { itemId: b.id });
    await submitCartAs(student, { note: null });
    const [lineA] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, a.id));
    const [lineB] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, b.id));
    // Cancel pending line A.
    await cancelRequestItemAs(student, {
      requestItemId: lineA.id,
      note: "no longer needed",
    });
    const [afterA] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, a.id));
    expect(afterA.status).toBe("available");
    // Approve B then check out, then attempt to cancel.
    await approveRequestItemAs(admin, {
      requestItemId: lineB.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: b.id,
      nextStatus: "checked_out",
      requestItemId: lineB.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86400000),
    });
    await expect(
      cancelRequestItemAs(student, {
        requestItemId: lineB.id,
        note: null,
      }),
    ).rejects.toThrow(/checkout/);
  });
});

describe("bulk approve in a batch is atomic", () => {
  it("a single failing line rolls back the whole batch when run in one tx", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const [a, b, c] = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of [a, b, c]) await addToCartAs(student, { itemId: i.id });
    await submitCartAs(student, { note: null });
    const lines = await db
      .select()
      .from(inventoryRequestItems)
      .where(inArray(inventoryRequestItems.itemId, [a.id, b.id, c.id]));
    // Tamper with line B: pre-close it so the approve call fails.
    await db
      .update(inventoryRequestItems)
      .set({ status: "cancelled", closedAt: new Date(), closedBy: student.id })
      .where(eq(inventoryRequestItems.id, lines[1].id));
    // Bulk approve all three inside one tx. Middle one will fail; the
    // first one should also roll back.
    await expect(
      db.transaction(async () => {
        for (const line of lines) {
          await approveRequestItemAs(admin, {
            requestItemId: line.id,
            pickupBy: null,
          });
        }
      }),
    ).rejects.toThrow();
    // First item should NOT be reserved.
    const [aAfter] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, a.id));
    expect(aAfter.status).toBe("requested");
  });
});

describe("past pickup window: lazy detection + idempotent notification", () => {
  it("writes one notification on first read; does not duplicate on second", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ name: "Cam" });
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: new Date(Date.now() - 86400000), // already passed
    });
    await recordOverdueNotificationsAs(student, { ownerId: student.id });
    await recordOverdueNotificationsAs(student, { ownerId: student.id });
    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, student.id),
          eq(notifications.type, "inventory_pickup_overdue"),
        ),
      );
    expect(notifs).toHaveLength(1);
    // Status unchanged (no auto-flip).
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("reserved");
  });
});

describe("defense in depth: impl re-checks role on every staff write", () => {
  it("createInventoryItemAs throws Forbidden for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    await expect(
      createInventoryItemAs(student, {
        name: "Sneaky",
        description: null,
        category: null,
        serial: null,
        location: null,
        notes: null,
        imageUrl: null,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("transitionItem throws Forbidden for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(student, { itemId: item.id, nextStatus: "retired" }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("approveRequestItemAs and rejectRequestItemAs throw Forbidden for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await expect(
      approveRequestItemAs(student, { requestItemId: line.id, pickupBy: null }),
    ).rejects.toThrow(/Forbidden/);
    await expect(
      rejectRequestItemAs(student, {
        requestItemId: line.id,
        reviewComment: "no",
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});

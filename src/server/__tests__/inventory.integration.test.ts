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
  getInventoryItemDetailAs,
  hardDeleteInventoryItemAs,
  listAdminInventoryAs,
  listInventoryAs,
  listMyItemsAs,
  recordOverdueNotificationsAs,
  rejectRequestItemAs,
  submitCartAs,
  updateInventoryItemAs,
} from "#/server/_internal/inventory";
import { transitionItem } from "#/server/_internal/inventory-transitions";

async function makeUser(email: string, role: "user" | "admin" | "instructor") {
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

async function makeItem(
  overrides: Partial<typeof inventoryItems.$inferInsert> = {}
) {
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
      })
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

  it("reserved transition requires exactly one holder, with or without a line", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    // No request line is needed any more, but a holder still is: an item
    // cannot be reserved to nobody.
    await expect(
      transitionItem(admin, { itemId: item.id, nextStatus: "reserved" })
    ).rejects.toThrow(/exactly one of holderId, holderEmail or holderLabel/);
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const { line } = await makeRequestLine(student.id, item.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: student.id,
        holderLabel: "X",
      })
    ).rejects.toThrow(/exactly one of holderId, holderEmail or holderLabel/);
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
    expect(notifs.some((n) => n.type === "inventory_request_approved")).toBe(
      true
    );
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
      })
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
      pickupBy: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderLabel: "Course demo",
      dueAt: new Date(Date.now() + 7 * 86_400_000),
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
      pickupBy: new Date(Date.now() + 86_400_000),
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
      pickupBy: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86_400_000),
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
    expect(notifs.some((n) => n.type === "inventory_item_returned")).toBe(true);
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
      pickupBy: new Date(Date.now() + 86_400_000),
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
    expect(notifs.some((n) => n.type === "inventory_request_closed")).toBe(
      true
    );
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
      })
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
      pickupBy: new Date(Date.now() + 86_400_000),
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

  it("includes the holder's name in the staff list rows", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const holderEmail = `lh-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const item = await makeItem({ currentHolderId: holder.id });
    const result = await listInventoryAs(admin, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id);
    expect(
      (found as unknown as { currentHolderName: string | null })
        .currentHolderName
    ).toBe(holderEmail);
  });

  it("keeps private notes off the detail page for a signed-in non-staff user", async () => {
    const admin = await makeUser(`pnd-a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`pnd-s-${Date.now()}@x.com`, "user");
    const item = await makeItem({
      notes: "Locker B4, code 1180.",
      serial: "SN-777",
      location: "Kelley 2063",
    });

    const studentView = await getInventoryItemAs(student, { id: item.id });
    expect(studentView).not.toBeNull();
    expect("notes" in (studentView as object)).toBe(false);
    expect("serial" in (studentView as object)).toBe(false);
    expect("location" in (studentView as object)).toBe(false);
    expect(JSON.stringify(studentView)).not.toContain("1180");

    const staffView = await getInventoryItemAs(admin, { id: item.id });
    expect((staffView as unknown as { notes: string }).notes).toBe(
      "Locker B4, code 1180."
    );
  });

  it("keeps private notes out of a non-staff list row", async () => {
    const student = await makeUser(`pnl-s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ notes: "Locker B4, code 1180." });

    const result = await listInventoryAs(student, {
      q: "",
      status: null,
      category: null,
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id);
    expect(found).toBeDefined();
    expect("notes" in (found as object)).toBe(false);
    expect(JSON.stringify(found)).not.toContain("1180");
  });

  it("carries the joined holder identity through the staff detail payload", async () => {
    // Guards the mapping that turns the joined row into the staff shape: the
    // holder name and email come from a LEFT JOIN, not from the item row, so
    // a refactor that rebuilt the payload could silently drop them while every
    // item-column assertion kept passing.
    const admin = await makeUser(`hj-a-${Date.now()}@x.com`, "admin");
    const holderEmail = `hj-h-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(holder.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: holder.id,
      pickupBy: new Date(Date.now() + 86_400_000),
    });

    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    expect(view?.viewerIsStaff).toBe(true);
    if (!view?.viewerIsStaff) {
      throw new Error("expected the staff branch");
    }
    expect(view.item.currentHolderId).toBe(holder.id);
    expect(view.item.currentHolderName).toBe(holderEmail);
    expect(view.item.currentHolderEmail).toBe(holderEmail);
    expect(view.item.pickupBy).toBeInstanceOf(Date);
  });

  it("does not leak the holder identity to a non-staff viewer", async () => {
    const admin = await makeUser(`hj-a2-${Date.now()}@x.com`, "admin");
    const holderEmail = `hj-h2-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const nosy = await makeUser(`hj-n2-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(holder.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: holder.id,
      pickupBy: new Date(Date.now() + 86_400_000),
    });

    const view = await getInventoryItemDetailAs(nosy, { id: item.id });
    expect(view?.viewerIsStaff).toBe(false);
    expect(JSON.stringify(view)).not.toContain(holderEmail);
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

  it("gives an anonymous viewer no history and no staff fields", async () => {
    const admin = await makeUser(`dtl-a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(null, { id: item.id });
    expect(view).not.toBeNull();
    expect(view?.viewerIsStaff).toBe(false);
    expect(view?.history).toEqual([]);
    expect("notes" in (view?.item as object)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("1180");
  });

  it("gives a signed-in non-staff user no history and no staff fields", async () => {
    const admin = await makeUser(`dtl-a2-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`dtl-s2-${Date.now()}@x.com`, "user");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(student, { id: item.id });
    expect(view?.viewerIsStaff).toBe(false);
    expect(view?.history).toEqual([]);
    expect("serial" in (view?.item as object)).toBe(false);
    expect("location" in (view?.item as object)).toBe(false);
  });

  it("gives staff the history and the staff fields", async () => {
    const admin = await makeUser(`dtl-a3-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ notes: "Locker B4, code 1180." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    expect(view?.viewerIsStaff).toBe(true);
    expect(view?.history.length).toBeGreaterThan(0);
    expect((view?.item as unknown as { notes: string }).notes).toBe(
      "Locker B4, code 1180."
    );
  });

  it("returns null for a retired item viewed by a non-staff user", async () => {
    const admin = await makeUser(`dtl-a4-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`dtl-s4-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });

    expect(await getInventoryItemDetailAs(student, { id: item.id })).toBeNull();
    expect(await getInventoryItemDetailAs(null, { id: item.id })).toBeNull();
    expect(
      (await getInventoryItemDetailAs(admin, { id: item.id }))?.item.status
    ).toBe("retired");
  });

  it("returns null for an item that does not exist", async () => {
    const admin = await makeUser(`dtl-a5-${Date.now()}@x.com`, "admin");
    const missing = "00000000-0000-0000-0000-0000000000ff";
    expect(await getInventoryItemDetailAs(admin, { id: missing })).toBeNull();
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
      label: null,
      location: null,
      notes: null,
      imageUrl: null,
    };
    await expect(createInventoryItemAs(student, blank)).rejects.toThrow(
      /Forbidden/
    );
    await expect(
      updateInventoryItemAs(student, {
        id: "00000000-0000-0000-0000-000000000000",
        ...blank,
      })
    ).rejects.toThrow(/Forbidden/);
    await expect(
      hardDeleteInventoryItemAs(student, {
        id: "00000000-0000-0000-0000-000000000000",
        confirmName: "X",
      })
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
      label: null,
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
      new Set(["name", "location"])
    );
    expect(logs[0].oldValues).toMatchObject({
      name: "Old",
      location: "Shelf A",
    });
    expect(logs[0].newValues).toMatchObject({
      name: "New",
      location: "Shelf B",
    });
  });

  it("persists label, exposing it to staff but not the public", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const created = await createInventoryItemAs(admin, {
      name: "Camera",
      description: null,
      category: null,
      serial: "SN-9",
      label: "LAB-042",
      location: null,
      notes: null,
      imageUrl: null,
    });
    expect(created.label).toBe("LAB-042");

    const staffView = await getInventoryItemAs(admin, { id: created.id });
    expect((staffView as unknown as { label: string }).label).toBe("LAB-042");

    const publicView = await getInventoryItemAs(null, { id: created.id });
    expect(publicView).not.toHaveProperty("label");
  });

  it("logs label changes in the edit log", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const created = await createInventoryItemAs(admin, {
      name: "Camera",
      description: null,
      category: null,
      serial: null,
      label: "OLD-1",
      location: null,
      notes: null,
      imageUrl: null,
    });
    await updateInventoryItemAs(admin, {
      id: created.id,
      name: "Camera",
      description: null,
      category: null,
      serial: null,
      label: "NEW-2",
      location: null,
      notes: null,
      imageUrl: null,
    });
    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, created.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].changedFields).toContain("label");
  });

  it("exposes the current holder's name + email to staff, not the public", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const holderEmail = `req-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const item = await makeItem({ currentHolderId: holder.id });

    const staffView = (await getInventoryItemAs(admin, {
      id: item.id,
    })) as unknown as {
      currentHolderName: string | null;
      currentHolderEmail: string | null;
    };
    expect(staffView.currentHolderEmail).toBe(holderEmail);
    expect(staffView.currentHolderName).toBe(holderEmail);

    const publicView = await getInventoryItemAs(null, { id: item.id });
    expect(publicView).not.toHaveProperty("currentHolderName");
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
      pickupBy: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Scope" })
    ).rejects.toThrow(/available or retired/);
  });

  it("hard-delete refuses when name confirmation does not match", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Real" });
    // Retire first so the status gate cannot fire instead and mask a name-gate bug.
    await transitionItem(admin, { itemId: item.id, nextStatus: "retired" });
    await expect(
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Wrong" })
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
      hardDeleteInventoryItemAs(admin, { id: item.id, confirmName: "Cabled" })
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
    await expect(addToCartAs(student, { itemId: item.id })).rejects.toThrow(
      /available/
    );
  });

  it("submit happy path: one request, N lines, items move to requested", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const items = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of items) {
      await addToCartAs(student, { itemId: i.id });
    }
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
    expect(notifs.some((n) => n.type === "inventory_request_approved")).toBe(
      true
    );
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
      })
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
      dueAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await expect(
      cancelRequestItemAs(student, {
        requestItemId: lineB.id,
        note: null,
      })
    ).rejects.toThrow(/checkout/);
  });
});

describe("bulk approve in a batch is atomic", () => {
  it("a single failing line rolls back the whole batch when run in one tx", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const [a, b, c] = await Promise.all([makeItem(), makeItem(), makeItem()]);
    for (const i of [a, b, c]) {
      await addToCartAs(student, { itemId: i.id });
    }
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
      db.transaction(async (tx) => {
        for (const line of lines) {
          await approveRequestItemAs(
            admin,
            { requestItemId: line.id, pickupBy: null },
            tx
          );
        }
      })
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
      pickupBy: new Date(Date.now() - 86_400_000), // already passed
    });
    await recordOverdueNotificationsAs(student, { ownerId: student.id });
    await recordOverdueNotificationsAs(student, { ownerId: student.id });
    const notifs = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, student.id),
          eq(notifications.type, "inventory_pickup_overdue")
        )
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
        label: null,
        location: null,
        notes: null,
        imageUrl: null,
      })
    ).rejects.toThrow(/Forbidden/);
  });

  it("transitionItem throws Forbidden for a non-staff viewer", async () => {
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(student, { itemId: item.id, nextStatus: "retired" })
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
      approveRequestItemAs(student, { requestItemId: line.id, pickupBy: null })
    ).rejects.toThrow(/Forbidden/);
    await expect(
      rejectRequestItemAs(student, {
        requestItemId: line.id,
        reviewComment: "no",
      })
    ).rejects.toThrow(/Forbidden/);
  });
});

describe("staff-assigned holds without a request line", () => {
  it("checks out an available item to a bare label", async () => {
    const admin = await makeUser(`wi-a-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    const dueAt = new Date(Date.now() + 3 * 86_400_000);

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderLabel: "Lab 204",
      dueAt,
    });

    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("checked_out");
    expect(after.currentHolderLabel).toBe("Lab 204");
    expect(after.currentRequestItemId).toBeNull();
    // The due date has to survive on the item itself; before this existed it
    // could only live on a request line the item never had.
    expect(after.currentDueAt?.getTime()).toBe(dueAt.getTime());
  });

  it("resolves an assigned email to the matching account and notifies it", async () => {
    const admin = await makeUser(`wi-a2-${Date.now()}@x.com`, "admin");
    const holderEmail = `wi-h2-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBe(holder.id);
    expect(after.currentHolderEmail).toBe(holderEmail);
    // The history row must look like any other account-backed hold: the
    // address resolved, so it belongs in holderId, not in the label column
    // the history list prefers when rendering.
    const [historyRow] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(historyRow.holderId).toBe(holder.id);
    expect(historyRow.holderLabel).toBeNull();
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));
    expect(notifs.some((n) => n.type === "inventory_item_checked_out")).toBe(
      true
    );
  });

  it("records an address with no account and keeps it staff-only", async () => {
    const admin = await makeUser(`wi-a3-${Date.now()}@x.com`, "admin");
    const nosy = await makeUser(`wi-n3-${Date.now()}@x.com`, "user");
    const holderEmail = `wi-ghost-${Date.now()}@x.com`;
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      holderEmail,
      pickupBy: new Date(Date.now() + 86_400_000),
    });

    const staffView = await getInventoryItemDetailAs(admin, { id: item.id });
    if (!staffView?.viewerIsStaff) {
      throw new Error("expected the staff branch");
    }
    expect(staffView.item.currentHolderId).toBeNull();
    expect(staffView.item.currentHolderEmail).toBe(holderEmail);
    expect(staffView.item.pickupBy).toBeInstanceOf(Date);
    // With no account to point at, the address is the only thing that can
    // identify the holder in the history log.
    const [historyRow] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(historyRow.holderLabel).toBe(holderEmail);

    const publicView = await getInventoryItemDetailAs(nosy, { id: item.id });
    expect(JSON.stringify(publicView)).not.toContain(holderEmail);
  });

  it("notifies the holder when a request-less checkout is returned", async () => {
    const admin = await makeUser(`wi-a4-${Date.now()}@x.com`, "admin");
    const holderEmail = `wi-h4-${Date.now()}@x.com`;
    const holder = await makeUser(holderEmail, "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail,
      dueAt: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });

    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.currentHolderId).toBeNull();
    expect(after.currentHolderEmail).toBeNull();
    expect(after.currentDueAt).toBeNull();
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));
    expect(notifs.some((n) => n.type === "inventory_item_returned")).toBe(true);
  });

  it("still refuses a checkout with no due date", async () => {
    const admin = await makeUser(`wi-a5-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "checked_out",
        holderLabel: "Lab 204",
      })
    ).rejects.toThrow(/checked_out requires dueAt/);
  });

  it("finds a request-less hold by holder email in the staff table", async () => {
    const admin = await makeUser(`wi-a6-${Date.now()}@x.com`, "admin");
    const holderEmail = `wi-find-${Date.now()}@x.com`;
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const { rows } = await listAdminInventoryAs(admin, {
      category: null,
      q: holderEmail,
      status: null,
    });
    expect(rows.some((r) => r.id === item.id)).toBe(true);
  });
});

describe("staff-assigned holds in my items", () => {
  it("shows a hold that has no request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`h-holder-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Scope" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const { active } = await listMyItemsAs(holder);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("hold");
    expect(active[0].item.id).toBe(item.id);
  });

  it("does not leak another user's hold", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h2-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`h2-holder-${stamp}@x.com`, "user");
    const other = await makeUser(`h2-other-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Meter" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      holderId: holder.id,
    });

    const { active } = await listMyItemsAs(other);
    expect(active).toHaveLength(0);
  });

  it("does not duplicate an item that also has a request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h3-admin-${stamp}@x.com`, "admin");
    const requester = await makeUser(`h3-req-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Iron" });

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    // Approve so the item lands in the same status ("reserved") and with
    // the same holder the hold query looks for, and only the
    // currentRequestItemId link tells the two queries apart.
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    const [afterApprove] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(afterApprove.status).toBe("reserved");
    expect(afterApprove.currentHolderId).toBe(requester.id);
    expect(afterApprove.currentRequestItemId).not.toBeNull();

    const { active } = await listMyItemsAs(requester);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("request");
  });

  it("matches an unlinked hold by verified email", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h4-admin-${stamp}@x.com`, "admin");
    const item = await makeItem({ name: "Drill" });

    // Assign to an address with no account yet, so resolveHolderId finds
    // nothing and current_holder_id stays null.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: `walkin-${stamp}@x.com`,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const walkIn = await makeUser(`walkin-${stamp}@x.com`, "user");
    const { active } = await listMyItemsAs(walkIn);

    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe("hold");
  });

  it("does not match by email when the address is unverified", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h5-admin-${stamp}@x.com`, "admin");
    const item = await makeItem({ name: "Saw" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: `unverified-${stamp}@x.com`,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const impostor = await makeUser(`unverified-${stamp}@x.com`, "user");
    await db
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, impostor.id));

    const { active } = await listMyItemsAs(impostor);
    expect(active).toHaveLength(0);
  });

  it("does not let a stale holder email override an explicit account assignment", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h6-admin-${stamp}@x.com`, "admin");
    const holderA = await makeUser(`h6-a-${stamp}@x.com`, "user");
    const holderB = await makeUser(`h6-b-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Level" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holderA.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });
    // current_holder_id is an explicit account assignment to holderA. Force
    // current_holder_email to collide with holderB's verified address, a
    // state the write path never produces on its own but that the read
    // side must still resolve in holderA's favor.
    await db
      .update(inventoryItems)
      .set({ currentHolderEmail: `h6-b-${stamp}@x.com` })
      .where(eq(inventoryItems.id, item.id));

    const { active } = await listMyItemsAs(holderB);
    expect(active).toHaveLength(0);
  });
});

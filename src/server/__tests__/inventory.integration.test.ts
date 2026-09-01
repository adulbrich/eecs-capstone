import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "#/db";
import {
  categories,
  inventoryCartItems,
  inventoryItemCategories,
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
  createCategoryAs,
  deleteCategoryAs,
} from "#/server/_internal/categories";
import { addToCartAs, submitCartAs } from "#/server/_internal/inventory-cart";
import {
  createInventoryItemAs,
  getInventoryItemAs,
  getInventoryItemDetailAs,
  hardDeleteInventoryItemAs,
  listAdminInventoryAs,
  listInventoryAs,
  listInventoryCategoriesImpl,
  updateInventoryItemAs,
} from "#/server/_internal/inventory-catalog";
import {
  collectedByForRequestItems,
  listInventoryRequestsAs,
  listMyItemsAs,
} from "#/server/_internal/inventory-holdings";
import { recordOverdueNotificationsAs } from "#/server/_internal/inventory-overdue";
import {
  approveRequestItemAs,
  cancelRequestItemAs,
  rejectRequestItemAs,
} from "#/server/_internal/inventory-requests";
import { transitionItem } from "#/server/_internal/inventory-transitions";
import { itemPayloadSchema } from "#/server/inventory";

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

async function makeCategory(name: string) {
  const [row] = await db
    .insert(categories)
    .values({ name, domain: "inventory", type: null })
    .returning();
  return row;
}

/** The non-category fields createInventoryItemAs/updateInventoryItemAs require. */
function baseItemInput(name: string) {
  return {
    name,
    description: null,
    serial: null,
    label: null,
    location: null,
    notes: null,
    imageUrl: null,
  };
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

  it("refuses a request line that is already closed", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await db
      .update(inventoryRequestItems)
      .set({ status: "cancelled", closedAt: new Date() })
      .where(eq(inventoryRequestItems.id, line.id));
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: student.id,
      })
    ).rejects.toThrow(/no longer open/);
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("available");
    expect(after.currentRequestItemId).toBeNull();
  });

  it("refuses a request line that belongs to a different item", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const other = await makeItem();
    const { line } = await makeRequestLine(student.id, other.id);
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: student.id,
      })
    ).rejects.toThrow(/different item/);
  });

  it("refuses a request line that does not exist", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "reserved",
        requestItemId: "00000000-0000-0000-0000-000000000000",
        holderId: student.id,
      })
    ).rejects.toThrow(/Request line not found/);
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
      categories: [],
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
      categories: [],
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
      categories: [],
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
    // ZQXNOTES is alphabetic and appears nowhere else in this file's item
    // names (Item-${Date.now()}-${Math.random()}, all digits and a dot), so
    // unlike a numeric substring it cannot turn up in the serialized payload
    // by chance.
    const item = await makeItem({
      notes: "Locker B4, code ZQXNOTES.",
      serial: "SN-777",
      location: "Kelley 2063",
    });

    const studentView = await getInventoryItemAs(student, { id: item.id });
    expect(studentView).not.toBeNull();
    expect("notes" in (studentView as object)).toBe(false);
    expect("serial" in (studentView as object)).toBe(false);
    expect("location" in (studentView as object)).toBe(false);
    expect(JSON.stringify(studentView)).not.toContain("ZQXNOTES");

    const staffView = await getInventoryItemAs(admin, { id: item.id });
    expect((staffView as unknown as { notes: string }).notes).toBe(
      "Locker B4, code ZQXNOTES."
    );
  });

  it("keeps private notes out of a non-staff list row", async () => {
    const student = await makeUser(`pnl-s-${Date.now()}@x.com`, "user");
    const item = await makeItem({ notes: "Locker B4, code ZQXNOTES." });

    const result = await listInventoryAs(student, {
      q: "",
      status: null,
      categories: [],
      page: 1,
      pageSize: 50,
    });
    const found = result.rows.find((r) => r.id === item.id);
    expect(found).toBeDefined();
    expect("notes" in (found as object)).toBe(false);
    expect(JSON.stringify(found)).not.toContain("ZQXNOTES");
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
      categories: [],
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
    const item = await makeItem({ notes: "Locker B4, code ZQXNOTES." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(null, { id: item.id });
    expect(view).not.toBeNull();
    expect(view?.viewerIsStaff).toBe(false);
    expect(view?.history).toEqual([]);
    expect("notes" in (view?.item as object)).toBe(false);
    expect(JSON.stringify(view)).not.toContain("ZQXNOTES");
  });

  it("gives a signed-in non-staff user no history and no staff fields", async () => {
    const admin = await makeUser(`dtl-a2-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`dtl-s2-${Date.now()}@x.com`, "user");
    const item = await makeItem({ notes: "Locker B4, code ZQXNOTES." });
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
    const item = await makeItem({ notes: "Locker B4, code ZQXNOTES." });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "maintenance",
    });

    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    expect(view?.viewerIsStaff).toBe(true);
    expect(view?.history.length).toBeGreaterThan(0);
    expect((view?.item as unknown as { notes: string }).notes).toBe(
      "Locker B4, code ZQXNOTES."
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
      categoryIds: [],
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
      categoryIds: [],
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

  // Pins the early-return path the deleted EDITABLE_FIELDS list used to put
  // at risk: an edit whose only changed field was missing from that list
  // computed `changed.length === 0`, took the return before the UPDATE, and
  // reported success having saved nothing. `diffRowFields` reads the writer's
  // own keys now, so there is no list left to drift, but the early return is
  // still there and this pins that it fires only on a genuine no-op
  // by asserting the write actually reached the row, not just the log.
  it("persists every editable field when it is the only one that changed", async () => {
    // The regression guard for the defect this replaced. `updateInventoryItemAs`
    // used to diff against a hand-maintained EDITABLE_FIELDS list while writing
    // a separate object literal, and nothing held the two in step: dropping
    // description, serial, notes or imageUrl from the list left typecheck and
    // this whole suite green while an edit touching only that field hit the
    // empty-diff early return, saved nothing, and reported success.
    //
    // Each field is edited alone, so a field that stops being diffed fails
    // here by name rather than being covered incidentally by a multi-field
    // edit that some other field rescued.
    const admin = await makeUser(`edit-all-${Date.now()}@x.com`, "admin");
    const edits = [
      { field: "name", from: "Before", to: "After" },
      { field: "description", from: null, to: "A description" },
      { field: "serial", from: null, to: "SN-1" },
      { field: "label", from: null, to: "Bench 3" },
      { field: "location", from: "Shelf A", to: "Shelf B" },
      { field: "notes", from: null, to: "Private note" },
      // `to` is a placeholder for this one field: an image key has to sit
      // under the item's own prefix, which is not known until the row below
      // exists, so the loop resolves it. See #162.
      { field: "imageUrl", from: null, to: "" },
    ] as const;

    for (const { field, from, to: literal } of edits) {
      const item = await makeItem({ name: "Before", location: "Shelf A" });
      const to = field === "imageUrl" ? `inventory/${item.id}/x.webp` : literal;
      const base = {
        id: item.id,
        categoryIds: [],
        description: null,
        imageUrl: null,
        label: null,
        location: "Shelf A",
        name: "Before",
        notes: null,
        serial: null,
      };

      await updateInventoryItemAs(admin, { ...base, [field]: to });

      const [row] = await db
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, item.id));
      expect(row[field], `${field} was not written to the row`).toBe(to);

      const logs = await db
        .select()
        .from(inventoryItemEditLog)
        .where(eq(inventoryItemEditLog.itemId, item.id));
      expect(logs, `${field} produced no edit-log row`).toHaveLength(1);
      expect(logs[0].changedFields).toEqual([field]);
      expect(logs[0].oldValues).toMatchObject({ [field]: from });
      expect(logs[0].newValues).toMatchObject({ [field]: to });
    }
  });

  it("logs changed fields in the order the writer builds them", async () => {
    // QUIRKS calls this order observable on the projects side and pins it
    // there. Inventory has the same dependency now that its diff reads the
    // writer's keys, because object key order is insertion order for string
    // keys, so reordering that literal changes what a reader of the edit log
    // sees. Nothing renders this log yet; the point is that changing it is
    // loud rather than silent.
    const admin = await makeUser(`edit-order-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Before", location: "Shelf A" });

    await updateInventoryItemAs(admin, {
      categoryIds: [],
      description: "d",
      id: item.id,
      imageUrl: `inventory/${item.id}/x.webp`,
      label: "Bench 3",
      location: "Shelf B",
      name: "After",
      notes: "n",
      serial: "SN-1",
    });

    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, item.id));
    expect(logs[0].changedFields).toEqual([
      "name",
      "description",
      "serial",
      "label",
      "location",
      "notes",
      "imageUrl",
    ]);
  });

  it("a single-field update persists to the row, not just the edit log", async () => {
    const admin = await makeUser(`a1-${Date.now()}@x.com`, "admin");
    const item = await makeItem({ name: "Widget", location: "Shelf A" });

    const result = await updateInventoryItemAs(admin, {
      id: item.id,
      name: "Widget",
      description: null,
      categoryIds: [],
      serial: null,
      label: null,
      location: "Shelf B",
      notes: null,
      imageUrl: null,
    });
    expect(result.location).toBe("Shelf B");

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.location).toBe("Shelf B");

    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, item.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].changedFields).toEqual(["location"]);
    expect(logs[0].oldValues).toMatchObject({ location: "Shelf A" });
    expect(logs[0].newValues).toMatchObject({ location: "Shelf B" });
  });

  it("persists label, exposing it to staff but not the public", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const created = await createInventoryItemAs(admin, {
      name: "Camera",
      description: null,
      categoryIds: [],
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
      categoryIds: [],
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
      categoryIds: [],
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

describe("category write path", () => {
  // Routes the payload through itemPayloadSchema, exactly like
  // createInventoryItem's server function does, rather than calling
  // createInventoryItemAs directly. That is the point: the bug this test
  // guards against was Zod silently stripping `categoryIds` at that exact
  // boundary while every direct-call test kept passing. Reading the join
  // table back from the database (not trusting the function's return value)
  // is what makes the assertion end-to-end.
  it("persists categoryIds when an item is created through the payload schema", async () => {
    const admin = await makeUser(`catw-${Date.now()}@x.com`, "admin");
    const category = await makeCategory("Cameras");
    const rawPayload: unknown = {
      name: "Payload Camera",
      categoryIds: [category.id],
    };
    const parsed = itemPayloadSchema.parse(rawPayload);
    const created = await createInventoryItemAs(admin, parsed);

    const rows = await db
      .select()
      .from(inventoryItemCategories)
      .where(eq(inventoryItemCategories.itemId, created.id));
    expect(rows.map((r) => r.categoryId)).toEqual([category.id]);
  });

  it("persists categoryIds when an item is updated through the payload schema", async () => {
    const admin = await makeUser(`catw2-${Date.now()}@x.com`, "admin");
    const category = await makeCategory("Microscopes");
    const item = await makeItem({ name: "Uncategorized scope" });
    const rawPayload: unknown = {
      id: item.id,
      name: item.name,
      categoryIds: [category.id],
    };
    // Same `.extend` shape as updatePayloadSchema in src/server/inventory.ts,
    // built from the same base so this test breaks the same way that schema
    // would if `categoryIds` were ever dropped from it.
    const updateSchema = itemPayloadSchema.extend({ id: z.string().uuid() });
    const validated = updateSchema.parse(rawPayload);
    await updateInventoryItemAs(admin, validated);

    const rows = await db
      .select()
      .from(inventoryItemCategories)
      .where(eq(inventoryItemCategories.itemId, item.id));
    expect(rows.map((r) => r.categoryId)).toEqual([category.id]);
  });
});

describe("category read path: correlated subquery and all-match filter", () => {
  it("keeps an uncategorized item visible and reports its categories for a categorized one", async () => {
    const admin = await makeUser(`crp-${Date.now()}@x.com`, "admin");
    const category = await makeCategory(`Robotics-${Date.now()}`);
    const categorized = await createInventoryItemAs(admin, {
      ...baseItemInput("Categorized Bot"),
      categoryIds: [category.id],
    });
    const uncategorized = await makeItem({ name: "Loose Bot" });

    const result = await listInventoryAs(null, {
      q: "",
      status: null,
      categories: [],
      page: 1,
      pageSize: 50,
    });

    const foundCategorized = result.rows.find((r) => r.id === categorized.id);
    const foundUncategorized = result.rows.find(
      (r) => r.id === uncategorized.id
    );

    // A correlated subquery cannot drop a row the way an inner join would;
    // the uncategorized item's presence with an empty array is the point.
    expect(foundUncategorized).toBeDefined();
    expect(foundUncategorized?.categories).toEqual([]);

    expect(foundCategorized).toBeDefined();
    expect(foundCategorized?.categories).toEqual([
      { id: category.id, name: category.name },
    ]);
  });

  it("filters by category id and excludes the uncategorized item", async () => {
    const admin = await makeUser(`crp2-${Date.now()}@x.com`, "admin");
    const category = await makeCategory(`Filters-${Date.now()}`);
    const categorized = await createInventoryItemAs(admin, {
      ...baseItemInput("Filtered Bot"),
      categoryIds: [category.id],
    });
    await makeItem({ name: "Unfiltered Bot" });

    const result = await listInventoryAs(null, {
      q: "",
      status: null,
      categories: [category.id],
      page: 1,
      pageSize: 50,
    });

    expect(result.rows.map((r) => r.id)).toEqual([categorized.id]);
  });
});

describe("listInventoryCategoriesImpl", () => {
  it("returns only categories actually assigned to a non-retired item, joined by id", async () => {
    const used = await makeCategory(`Used-${Date.now()}`);
    const unused = await makeCategory(`Unused-${Date.now()}`);
    const hasCategory = await makeItem({ name: "Has category" });
    await db
      .insert(inventoryItemCategories)
      .values({ itemId: hasCategory.id, categoryId: used.id });
    const retiredItem = await makeItem({ name: "Retired with category" });
    await db
      .insert(inventoryItemCategories)
      .values({ itemId: retiredItem.id, categoryId: unused.id });
    await db
      .update(inventoryItems)
      .set({ status: "retired" })
      .where(eq(inventoryItems.id, retiredItem.id));

    const { categories: rows } = await listInventoryCategoriesImpl();

    expect(rows.some((c) => c.id === used.id && c.name === used.name)).toBe(
      true
    );
    expect(rows.some((c) => c.id === unused.id)).toBe(false);
  });
});

describe("inventory item categories", () => {
  it("round-trips two categories through create and read", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Alpha-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Beta-${stamp}`,
      type: null,
    });

    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget-${stamp}`),
      categoryIds: [a.id, b.id],
    });

    const item = await getInventoryItemAs(admin, { id });
    expect(item?.categories.map((c) => c.name).sort()).toEqual(
      [`Alpha-${stamp}`, `Beta-${stamp}`].sort()
    );
  });

  // Categories sit outside the column diff and have their own, computed
  // before the same early return. This pins that the two diffs
  // agree on "nothing changed": a truly identical update (including
  // categoryIds) must still take the zero-log early return, not log a
  // spurious "categories" change because the two diffs disagree.
  it("a truly no-op update, including unchanged categoryIds, writes zero edit-log rows", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic5-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Same-${stamp}`,
      type: null,
    });
    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget5-${stamp}`),
      categoryIds: [a.id],
    });

    await updateInventoryItemAs(admin, {
      id,
      ...baseItemInput(`Widget5-${stamp}`),
      categoryIds: [a.id],
    });

    const logs = await db
      .select()
      .from(inventoryItemEditLog)
      .where(eq(inventoryItemEditLog.itemId, id));
    expect(logs).toHaveLength(0);
  });

  it("removing one category leaves the other", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic2-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Keep-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Drop-${stamp}`,
      type: null,
    });
    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget2-${stamp}`),
      categoryIds: [a.id, b.id],
    });

    await updateInventoryItemAs(admin, {
      id,
      ...baseItemInput(`Widget2-${stamp}`),
      categoryIds: [a.id],
    });

    const item = await getInventoryItemAs(admin, { id });
    expect(item?.categories.map((c) => c.name)).toEqual([`Keep-${stamp}`]);
  });

  it("deleting a category removes the assignment and keeps the item", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic3-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `Doomed-${stamp}`,
      type: null,
    });
    const { id } = await createInventoryItemAs(admin, {
      ...baseItemInput(`Widget3-${stamp}`),
      categoryIds: [a.id],
    });

    await deleteCategoryAs(admin, a.id);

    const item = await getInventoryItemAs(admin, { id });
    expect(item).toBeDefined();
    expect(item?.categories).toEqual([]);
  });

  it("filters on ALL selected categories, not any", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ic4-${stamp}@x.com`, "admin");
    const a = await createCategoryAs(admin, {
      domain: "inventory",
      name: `A-${stamp}`,
      type: null,
    });
    const b = await createCategoryAs(admin, {
      domain: "inventory",
      name: `B-${stamp}`,
      type: null,
    });
    const both = await createInventoryItemAs(admin, {
      ...baseItemInput(`Both-${stamp}`),
      categoryIds: [a.id, b.id],
    });
    await createInventoryItemAs(admin, {
      ...baseItemInput(`OnlyA-${stamp}`),
      categoryIds: [a.id],
    });

    const result = await listInventoryAs(admin, {
      categories: [a.id, b.id],
      page: 1,
      pageSize: 24,
      q: "",
      status: null,
    });

    expect(result.rows.map((r) => r.id)).toEqual([both.id]);
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

  it("reject tells the requester, and cancel tells nobody", async () => {
    // Neither notification was asserted anywhere before, so routing both
    // paths through transitionItem could have dropped the denial notice or
    // started emitting one for a self-cancel without the suite noticing.
    const admin = await makeUser(`an-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`sn-${Date.now()}@x.com`, "user");
    const rejected = await makeItem();
    const cancelled = await makeItem();
    await addToCartAs(student, { itemId: rejected.id });
    await addToCartAs(student, { itemId: cancelled.id });
    await submitCartAs(student, { note: null });
    const lines = await db
      .select()
      .from(inventoryRequestItems)
      .where(
        inArray(inventoryRequestItems.itemId, [rejected.id, cancelled.id])
      );
    const rejectedLine = lines.find((l) => l.itemId === rejected.id);
    const cancelledLine = lines.find((l) => l.itemId === cancelled.id);
    if (!(rejectedLine && cancelledLine)) {
      throw new Error("submitCart did not produce a line for both items");
    }

    await db.delete(notifications).where(eq(notifications.userId, student.id));
    await rejectRequestItemAs(admin, {
      requestItemId: rejectedLine.id,
      reviewComment: "Reserved for class",
    });
    await cancelRequestItemAs(student, {
      requestItemId: cancelledLine.id,
      note: "Changed my mind",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("inventory_request_rejected");
    expect(rows[0].message).toBe("Reserved for class");
    expect(rows[0].link).toBe("/my/items?tab=history");
  });

  it("denies the requester even when a teammate is holding the item", async () => {
    // Staff can take a still-pending item straight to checked_out for a
    // teammate: the override select has no gate on current status, and
    // syncRequestItem's checked_out arm writes only dueAt, so the line stays
    // pending while current_holder_id moves. A denial belongs to whoever
    // asked, so it must not follow the hold.
    const teammateEmail = `team-${Date.now()}@x.com`;
    const admin = await makeUser(`at-${Date.now()}@x.com`, "admin");
    const asker = await makeUser(`ask-${Date.now()}@x.com`, "user");
    const teammate = await makeUser(teammateEmail, "user");
    const item = await makeItem();
    await addToCartAs(asker, { itemId: item.id });
    await submitCartAs(asker, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: teammateEmail,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [held] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(held.currentHolderId).toBe(teammate.id);
    const [stillPending] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(stillPending.status).toBe("pending");

    await db.delete(notifications);
    await rejectRequestItemAs(admin, {
      requestItemId: line.id,
      reviewComment: "Needed for a class",
    });

    const denials = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "inventory_request_rejected"));
    expect(denials).toHaveLength(1);
    expect(denials[0].userId).toBe(asker.id);
  });

  it("keeps the history link to the line reject and cancel closed", async () => {
    const admin = await makeUser(`ah-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`sh-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await rejectRequestItemAs(admin, {
      requestItemId: line.id,
      reviewComment: "No",
    });
    const history = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    const release = history.find((h) => h.newStatus === "available");
    // A release cannot carry requestItemId, so this link survives only
    // because transitionItem falls back to the decision's line id.
    expect(release?.requestItemId).toBe(line.id);
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

  it("refuses a cancel from a student who does not own the line", async () => {
    // The requesterId check in cancelRequestItemAs is the whole enforcement
    // of "only the requester may cancel". assertAuthorized cannot help: it
    // reads authority, holderId and holderEmail and never the line's
    // requester, so it waves self_cancel through on a path that supplies
    // neither holder field. Delete that check and every other cancel case in
    // this file still passes, because they all pass the owning viewer.
    const requester = await makeUser(`cx-req-${Date.now()}@x.com`, "user");
    const otherStudent = await makeUser(`cx-oth-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));

    await expect(
      cancelRequestItemAs(otherStudent, {
        requestItemId: line.id,
        note: "not mine",
      })
    ).rejects.toThrow(/Only the requester can cancel/);

    const [untouched] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(untouched.status).toBe("pending");
    const [stillHeld] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(stillHeld.status).toBe("requested");
  });

  it("clears the walk-in name and program when a cancel releases the item", async () => {
    // Regression for the two release paths (reject, cancel) writing the
    // available arm's holder columns by hand instead of going through
    // transitionItem: they nulled the id/email/label trio but left the two
    // walk-in columns behind, so a cancelled reservation could still show a
    // stale name/program on an item the status badge reports as available.
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`s-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));

    // Staff reserves the request to a walk-in address with no matching
    // account, typing a name and program. The address must not resolve to
    // any account created in this file, or resolveHold would clear the
    // name/program at write time and the test would prove nothing.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderEmail: "cancel-stale-walkin@nowhere.test",
      holderName: "Stale Walkin",
      holderProgram: "CS 461",
    });

    const [reserved] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    // Confirm the columns actually got populated before the cancel, so a
    // silent failure to store them can't masquerade as the fix working.
    expect(reserved.currentHolderName).toBe("Stale Walkin");
    expect(reserved.currentHolderProgram).toBe("CS 461");

    // The line is now 'approved', which cancelRequestItemAs still permits as
    // long as the item is not checked_out.
    await cancelRequestItemAs(student, {
      requestItemId: line.id,
      note: "changed my mind",
    });

    const [released] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(released.status).toBe("available");
    expect(released.currentHolderName).toBeNull();
    expect(released.currentHolderProgram).toBeNull();
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
        categoryIds: [],
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
    // identify the holder in the history log, and it lives in its own
    // column rather than being smuggled into holderLabel.
    const [historyRow] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(historyRow.holderEmail).toBe(holderEmail);
    expect(historyRow.holderLabel).toBeNull();

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
      categories: [],
      q: holderEmail,
      retiredOnly: false,
      status: null,
    });
    expect(rows.some((r) => r.id === item.id)).toBe(true);
  });

  it("finds a walk-in hold by the stored name the Holder column renders", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`wi-a7-${stamp}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: `wi-name-${stamp}@nowhere.test`,
      holderName: `Wilhelmina Walkin ${stamp}`,
      holderProgram: `CS ${stamp}`,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    // The staff table puts currentHolderName first in the Holder column's
    // fallback chain, so a name that cannot be searched is a name staff can
    // read off the screen and then fail to find.
    const byName = await listAdminInventoryAs(admin, {
      categories: [],
      q: `Wilhelmina Walkin ${stamp}`,
      retiredOnly: false,
      status: null,
    });
    expect(byName.rows.some((r) => r.id === item.id)).toBe(true);
  });

  it("finds a walk-in hold by the stored program", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`wi-a8-${stamp}@x.com`, "admin");
    const item = await makeItem();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: `wi-prog-${stamp}@nowhere.test`,
      holderProgram: `CS ${stamp}`,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const byProgram = await listAdminInventoryAs(admin, {
      categories: [],
      q: `CS ${stamp}`,
      retiredOnly: false,
      status: null,
    });
    expect(byProgram.rows.some((r) => r.id === item.id)).toBe(true);
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
    const only = active[0];
    expect(only.kind).toBe("hold");
    if (only.kind === "hold") {
      expect(only.item.id).toBe(item.id);
    }
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

    // Assign to an address with no account yet, so resolveHold finds
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

  it("still shows a hold whose request line was closed behind it", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`h7-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`h7-holder-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Anemometer" });

    await addToCartAs(holder, { itemId: item.id });
    await submitCartAs(holder, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    // Close the line while the item still points at it. transitionItem now
    // refuses to create this state, but a row written before that guard
    // existed still has to render rather than disappear from both halves.
    await db
      .update(inventoryRequestItems)
      .set({ status: "returned", closedAt: new Date() })
      .where(eq(inventoryRequestItems.id, line.id));

    const { active } = await listMyItemsAs(holder);

    expect(active).toHaveLength(1);
    const only = active[0];
    expect(only.kind).toBe("hold");
    if (only.kind === "hold") {
      expect(only.item.id).toBe(item.id);
    }
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

describe("my items payload names every field it returns", () => {
  it("carries no column a consumer does not read, on either arm", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`shape-admin-${stamp}@x.com`, "admin");
    const viewer = await makeUser(`shape-viewer-${stamp}@x.com`, "user");
    const held = await makeItem({ name: "Held", notes: "Staff only note" });
    const requested = await makeItem({ name: "Requested" });

    await transitionItem(admin, {
      itemId: held.id,
      nextStatus: "checked_out",
      holderId: viewer.id,
      dueAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await addToCartAs(viewer, { itemId: requested.id });
    await submitCartAs(viewer, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, requested.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    const { active } = await listMyItemsAs(viewer);

    // The projections cannot widen on their own, because they name their
    // fields. What broke before was a db.select() above them handing whole
    // rows straight to the client, and an exact key set is what catches a
    // fourth read path written the same way.
    const hold = active.find((e) => e.kind === "hold");
    expect(hold).toBeDefined();
    if (hold?.kind === "hold") {
      expect(Object.keys(hold.item).sort()).toEqual([
        "dueAt",
        "id",
        "name",
        "pickupBy",
        "status",
        "updatedAt",
      ]);
    }

    const request = active.find((e) => e.kind === "request");
    expect(request).toBeDefined();
    if (request?.kind === "request") {
      expect(Object.keys(request).sort()).toEqual([
        "collectedBy",
        "itemName",
        "itemStatus",
        "kind",
        "line",
      ]);
      expect(Object.keys(request.line).sort()).toEqual([
        "closedReason",
        "createdAt",
        "dueAt",
        "id",
        "pickupBy",
        "status",
      ]);
    }
  });
});

describe("active tab ordering (byDeadline)", () => {
  it("sorts by soonest deadline, then newest first when there is no deadline", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ord-admin-${stamp}@x.com`, "admin");
    const viewer = await makeUser(`ord-viewer-${stamp}@x.com`, "user");

    const soonItem = await makeItem({ name: "Soon Hold" });
    const laterItem = await makeItem({ name: "Later Request" });
    // Named so alphabetical order and recency order disagree: "Apple" sorts
    // before "Zebra", but Zebra is the one created second and must still
    // sort first once the tiebreak is recency rather than name. A test that
    // used "Older"/"Newer" names here would pass under either tiebreak and
    // would not catch a regression back to the old name-based one.
    const olderItem = await makeItem({ name: "Apple Pending" });
    const newerItem = await makeItem({ name: "Zebra Pending" });

    // A hold with the soonest deadline of the four.
    await transitionItem(admin, {
      itemId: soonItem.id,
      nextStatus: "checked_out",
      holderId: viewer.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    // A request line with a later deadline: approved, so pickupBy is set.
    await addToCartAs(viewer, { itemId: laterItem.id });
    await submitCartAs(viewer, { note: null });
    const [laterLine] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, laterItem.id));
    await approveRequestItemAs(admin, {
      requestItemId: laterLine.id,
      pickupBy: new Date(Date.now() + 5 * 86_400_000),
    });

    // Two pending request lines with no deadline. createdAt is set
    // explicitly rather than relying on the two submitCartAs calls landing
    // in different milliseconds, so the ordering this asserts cannot flake.
    await addToCartAs(viewer, { itemId: olderItem.id });
    await submitCartAs(viewer, { note: null });
    await addToCartAs(viewer, { itemId: newerItem.id });
    await submitCartAs(viewer, { note: null });
    await db
      .update(inventoryRequestItems)
      .set({ createdAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(inventoryRequestItems.itemId, olderItem.id));
    await db
      .update(inventoryRequestItems)
      .set({ createdAt: new Date("2020-01-02T00:00:00.000Z") })
      .where(eq(inventoryRequestItems.itemId, newerItem.id));

    const { active } = await listMyItemsAs(viewer);

    // With no deadline to sort by, these fall back to recency, newest
    // first: the created_at DESC order the active list used before holds
    // existed. Under the old name tiebreak this would come back
    // alphabetically ("Apple Pending" before "Zebra Pending") instead.
    expect(
      active.map((entry) =>
        entry.kind === "hold" ? entry.item.name : entry.itemName
      )
    ).toEqual(["Soon Hold", "Later Request", "Zebra Pending", "Apple Pending"]);
  });

  it("falls back to newest first when two entries share the same deadline", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`ordeq-admin-${stamp}@x.com`, "admin");
    const viewer = await makeUser(`ordeq-viewer-${stamp}@x.com`, "user");

    // Named, like the case above, so alphabetical order and recency order
    // disagree: "Ant" sorts before "Yak" alphabetically, but Yak is the one
    // last written and must sort first under the recency tiebreak.
    const olderItem = await makeItem({ name: "Ant Match" });
    const newerItem = await makeItem({ name: "Yak Match" });
    const sharedDeadline = new Date(Date.now() + 3 * 86_400_000);

    await transitionItem(admin, {
      itemId: olderItem.id,
      nextStatus: "checked_out",
      holderId: viewer.id,
      dueAt: sharedDeadline,
    });
    await transitionItem(admin, {
      itemId: newerItem.id,
      nextStatus: "checked_out",
      holderId: viewer.id,
      dueAt: sharedDeadline,
    });
    // Recency for a hold comes from the item's updatedAt. Set both
    // explicitly, rather than trusting the two transitionItem calls above to
    // land in different milliseconds, so this cannot flake.
    await db
      .update(inventoryItems)
      .set({ updatedAt: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(inventoryItems.id, olderItem.id));
    await db
      .update(inventoryItems)
      .set({ updatedAt: new Date("2020-01-02T00:00:00.000Z") })
      .where(eq(inventoryItems.id, newerItem.id));

    const { active } = await listMyItemsAs(viewer);

    // Equal deadlines: falls back to recency, newest first. Under the old
    // name tiebreak this would come back alphabetically ("Ant Match" before
    // "Yak Match") instead.
    expect(
      active.map((entry) =>
        entry.kind === "hold" ? entry.item.name : entry.itemName
      )
    ).toEqual(["Yak Match", "Ant Match"]);
  });
});

describe("disjointness invariant between the hold and request-line queries", () => {
  it("double-counts an item if it is ever forced into the orphaned state", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`orphan-admin-${stamp}@x.com`, "admin");
    const requester = await makeUser(`orphan-req-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Orphan" });

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    // closeRequestItemOnRelease closes the attached line whenever
    // current_request_item_id goes null, so a live approved line and a
    // null current_request_item_id never coexist on the write path. Force
    // that pairing directly to check whether the read side has any defense
    // of its own for it, or leans entirely on the write path never
    // producing it: the item is still "reserved" and still held by
    // requester, but current_request_item_id is cleared as if the item had
    // been released while the line was left behind.
    await db
      .update(inventoryItems)
      .set({ currentRequestItemId: null })
      .where(eq(inventoryItems.id, item.id));

    const { active } = await listMyItemsAs(requester);

    // This pins the current (undesirable) behavior, not a guarantee: the
    // request-line query does not check current_request_item_id at all,
    // and the hold query matches once current_request_item_id is null, so
    // the item comes back from both and appears twice. There is no
    // independent read-side defense; disjointness holds only as long as
    // closeRequestItemOnRelease is never bypassed. If a future change
    // closes that gap, update this test to expect a single entry.
    expect(active).toHaveLength(2);
  });
});

describe("a teammate collects a requested item", () => {
  it("shows the request to the requester and the hold to the picker", async () => {
    const admin = await makeUser("cross-admin@x.com", "admin");
    const requester = await makeUser("cross-requester@x.com", "user");
    const picker = await makeUser("cross-picker@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    // The teammate walks in. Staff replace the prefilled address.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "cross-picker@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const requesterView = await listMyItemsAs(requester);
    const requesterEntries = requesterView.active.filter(
      (e) => e.kind === "request"
    );
    expect(requesterEntries).toHaveLength(1);
    expect(requesterEntries[0].kind).toBe("request");

    const pickerView = await listMyItemsAs(picker);
    const pickerEntries = pickerView.active.filter((e) => e.kind === "hold");
    expect(pickerEntries).toHaveLength(1);
    expect(pickerEntries[0].kind).toBe("hold");
  });

  it("leaves the request line approved so the requester keeps seeing it", async () => {
    const admin = await makeUser("cross-admin-2@x.com", "admin");
    const requester = await makeUser("cross-requester-2@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "someone-else@nowhere.test",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [after] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    // listMyItemsAs only puts pending and approved lines in the Active tab,
    // and syncRequestItem's checked_out arm sets dueAt without touching
    // status. Asserted directly, because the requester's whole view of a
    // teammate's pickup depends on that arm continuing to leave it alone.
    expect(after.status).toBe("approved");
  });
});

describe("overdue notifications for staff holds", () => {
  it("notifies the holder of an overdue hold with no request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`o-holder-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Lathe" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));

    expect(
      rows.filter((r) => r.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });

  it("does not notify twice when run again", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o2-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`o2-holder-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Press" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });
    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));

    expect(
      rows.filter((r) => r.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });

  it("notifies the holder of an overdue pickup with no request line", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o3-admin-${stamp}@x.com`, "admin");
    const holder = await makeUser(`o3-holder-${stamp}@x.com`, "user");
    const item = await makeItem({ name: "Router" });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      holderId: holder.id,
      pickupBy: new Date("2020-01-01T00:00:00.000Z"),
    });

    await recordOverdueNotificationsAs(holder, { ownerId: holder.id });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, holder.id));

    expect(
      rows.filter((r) => r.type === "inventory_pickup_overdue")
    ).toHaveLength(1);
  });

  it("does not notify an email-matched hold with no resolved account", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`o4-admin-${stamp}@x.com`, "admin");
    const holderEmail = `o4-walkin-${stamp}@x.com`;
    const item = await makeItem({ name: "Grinder" });

    // Assign to an address with no account yet, so resolveHold finds
    // nothing and current_holder_id stays null: this hold is discoverable
    // only through listMyItemsAs's verified-email match, which the
    // notification write path deliberately does not repeat.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail,
      dueAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const walkIn = await makeUser(holderEmail, "user");

    // No ownerId: an ownerId scope would filter the null-holder row out on
    // its own, masking the guard this test exists to pin. What actually
    // keeps this row out of the insert is the `r.userId !== null` filter
    // applied after the two scans are merged (inventory.ts, just above the
    // push loop), not the `currentHolderId IS NOT NULL` condition on the
    // hold query: that condition could be dropped entirely and this test
    // would still pass, since the JS filter catches the row first.
    await expect(
      recordOverdueNotificationsAs(walkIn, {})
    ).resolves.not.toThrow();

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, walkIn.id));

    expect(
      rows.filter(
        (r) =>
          r.type === "inventory_checkout_overdue" ||
          r.type === "inventory_pickup_overdue"
      )
    ).toHaveLength(0);
  });
});

describe("overdue notifications with two parties", () => {
  async function checkedOutToSomeoneElse(prefix: string) {
    const admin = await makeUser(`${prefix}-admin@x.com`, "admin");
    const requester = await makeUser(`${prefix}-requester@x.com`, "user");
    const picker = await makeUser(`${prefix}-picker@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: `${prefix}-picker@x.com`,
      dueAt: new Date(Date.now() - 86_400_000),
    });
    return { admin, item, picker, requester };
  }

  it("notifies the requester and the picker", async () => {
    const { admin, item, picker, requester } =
      await checkedOutToSomeoneElse("overdue-two");
    await recordOverdueNotificationsAs(admin);

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/inventory/${item.id}`));
    const overdue = notes.filter(
      (n) => n.type === "inventory_checkout_overdue"
    );
    expect(overdue.map((n) => n.userId).sort()).toEqual(
      [requester.id, picker.id].sort()
    );
  });

  it("notifies a requester who collected their own item exactly once", async () => {
    const admin = await makeUser("overdue-one-admin@x.com", "admin");
    const student = await makeUser("overdue-one-student@x.com", "user");
    const item = await makeItem();
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
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "overdue-one-student@x.com",
      dueAt: new Date(Date.now() - 86_400_000),
    });

    await recordOverdueNotificationsAs(admin);

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.link, `/inventory/${item.id}`));
    expect(
      notes.filter((n) => n.type === "inventory_checkout_overdue")
    ).toHaveLength(1);
  });
});

describe("holder resolution", () => {
  it("stores the address when only an account id is given", async () => {
    const admin = await makeUser("resolve-admin@x.com", "admin");
    const holder = await makeUser("resolve-holder@x.com", "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderId: holder.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBe(holder.id);
    expect(row.currentHolderEmail).toBe("resolve-holder@x.com");
    expect(row.currentHolderLabel).toBeNull();
  });

  it("resolves an address to an account and ignores a supplied name", async () => {
    const admin = await makeUser("resolve-admin-2@x.com", "admin");
    const holder = await makeUser("resolve-holder-2@x.com", "user");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "resolve-holder-2@x.com",
      holderName: "Typed Name",
      holderProgram: "CS 461",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBe(holder.id);
    expect(row.currentHolderName).toBeNull();
    expect(row.currentHolderProgram).toBeNull();
  });

  it("keeps name and program for an address with no account", async () => {
    const admin = await makeUser("resolve-admin-3@x.com", "admin");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "walkin@nowhere.test",
      holderName: "Walk In",
      holderProgram: "CS 462",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBeNull();
    expect(row.currentHolderEmail).toBe("walkin@nowhere.test");
    expect(row.currentHolderName).toBe("Walk In");
    expect(row.currentHolderProgram).toBe("CS 462");
    expect(row.currentHolderLabel).toBeNull();
  });

  it("records the address on the history row instead of the label", async () => {
    const admin = await makeUser("resolve-admin-4@x.com", "admin");
    const item = await makeItem();

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      holderEmail: "history@nowhere.test",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const [h] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(h.holderEmail).toBe("history@nowhere.test");
    expect(h.holderLabel).toBeNull();
  });

  it("gives a self-submitted request hold an address", async () => {
    const student = await makeUser("cart-address@x.com", "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    await submitCartAs(student, { note: null });

    const [row] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(row.currentHolderId).toBe(student.id);
    expect(row.currentHolderEmail).toBe("cart-address@x.com");

    const [h] = await db
      .select()
      .from(inventoryItemStatusHistory)
      .where(eq(inventoryItemStatusHistory.itemId, item.id));
    expect(h.holderEmail).toBe("cart-address@x.com");
  });

  it("still notifies the requester on approve", async () => {
    const admin = await makeUser("approve-admin@x.com", "admin");
    const student = await makeUser("approve-student@x.com", "user");
    const item = await makeItem();
    await addToCartAs(student, { itemId: item.id });
    const { requestId } = await submitCartAs(student, { note: null });
    expect(requestId).not.toBeNull();
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));

    // submitCartAs now writes the requester's address, so clear it first.
    // The point of the assertions below is that approveRequestItemAs passes
    // only an account id, and resolveHold derives the address from it. With
    // the address left in place, they would pass on leftover state even if
    // the derivation were broken.
    await db
      .update(inventoryItems)
      .set({ currentHolderEmail: null })
      .where(eq(inventoryItems.id, item.id));

    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(notes.some((n) => n.type === "inventory_request_approved")).toBe(
      true
    );

    const [held] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    // The address was cleared above, so this can only pass if
    // approveRequestItemAs's holderId re-derived it via resolveHold.
    expect(held.currentHolderId).toBe(student.id);
    expect(held.currentHolderEmail).toBe("approve-student@x.com");
    expect(held.currentHolderLabel).toBeNull();
  });
});

describe("collected by", () => {
  it("survives the return", async () => {
    const admin = await makeUser("collected-admin@x.com", "admin");
    const requester = await makeUser("collected-requester@x.com", "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "walkin-collector@nowhere.test",
      holderName: "Walk In Collector",
      dueAt: new Date(Date.now() + 86_400_000),
    });
    // Returned: the item's holder columns are cleared, the line is closed.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "available",
    });

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe("walkin-collector@nowhere.test");
    expect(collected.get(line.id)?.name).toBe("Walk In Collector");
  });

  it("prefers the account's name over the typed one", async () => {
    const admin = await makeUser("collected-admin-2@x.com", "admin");
    // Created so the address below resolves to an account; the returned
    // handle is not needed, and an unused binding fails the linter.
    await makeUser("collected-picker@x.com", "user");
    const requester = await makeUser("collected-requester-2@x.com", "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "collected-picker@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe("collected-picker@x.com");
    expect(collected.get(line.id)?.name).toBe("collected-picker@x.com");
  });

  it("returns an empty map for no ids without querying", async () => {
    const collected = await collectedByForRequestItems([]);
    expect(collected.size).toBe(0);
  });

  it("reports the most recent checkout when a line was collected twice", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`twice-admin-${stamp}@x.com`, "admin");
    const requester = await makeUser(`twice-requester-${stamp}@x.com`, "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });

    // Collected, brought back to the counter, then collected again by
    // someone else. Both checkouts hang off the same request line, which is
    // the only state that can distinguish an ascending tiebreak from a
    // descending one.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: `first-collector-${stamp}@nowhere.test`,
      dueAt: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderEmail: `first-collector-${stamp}@nowhere.test`,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: `second-collector-${stamp}@nowhere.test`,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    // DISTINCT ON picks arbitrarily among tied sort keys, so a test that
    // relied on ordering without confirming the keys differ would pass or
    // fail by luck. Each transitionItem is its own transaction and Postgres
    // now() is transaction start time, so these must differ.
    const checkouts = await db
      .select({ createdAt: inventoryItemStatusHistory.createdAt })
      .from(inventoryItemStatusHistory)
      .where(
        and(
          eq(inventoryItemStatusHistory.requestItemId, line.id),
          eq(inventoryItemStatusHistory.newStatus, "checked_out")
        )
      );
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].createdAt.getTime()).not.toBe(
      checkouts[1].createdAt.getTime()
    );

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe(
      `second-collector-${stamp}@nowhere.test`
    );
  });

  it("prefers the account's current address over the one stored at checkout", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`rename-admin-${stamp}@x.com`, "admin");
    const requester = await makeUser(`rename-requester-${stamp}@x.com`, "user");
    const oldAddress = `rename-picker-${stamp}@x.com`;
    const picker = await makeUser(oldAddress, "user");
    const item = await makeItem();
    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: oldAddress,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    // The history row keeps the address the hold was assigned to. The person
    // then changes their account address. They are still the same collector,
    // so the read must follow the account rather than the frozen string.
    const newAddress = `renamed-${stamp}@x.com`;
    await db
      .update(user)
      .set({ email: newAddress })
      .where(eq(user.id, picker.id));

    const collected = await collectedByForRequestItems([line.id]);
    expect(collected.get(line.id)?.email).toBe(newAddress);
  });
});

describe("listMyItemsAs collectedBy gate", () => {
  it("hides the collector when the requester collected their own item", async () => {
    const admin = await makeUser("gate-admin-1@x.com", "admin");
    const requester = await makeUser("gate-requester-1@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    // The requester walks in and collects their own item; staff leave the
    // prefilled address alone.
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "gate-requester-1@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const { active } = await listMyItemsAs(requester);
    const entry = active.find((e) => e.kind === "request");
    expect(entry?.kind).toBe("request");
    if (entry?.kind === "request") {
      expect(entry.collectedBy).toBeNull();
    }
  });

  it("names a teammate who collected the item", async () => {
    const admin = await makeUser("gate-admin-2@x.com", "admin");
    const requester = await makeUser("gate-requester-2@x.com", "user");
    await makeUser("gate-picker-2@x.com", "user");
    const item = await makeItem();

    await addToCartAs(requester, { itemId: item.id });
    await submitCartAs(requester, { note: null });
    const [line] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.itemId, item.id));
    await approveRequestItemAs(admin, {
      requestItemId: line.id,
      pickupBy: null,
    });
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderEmail: "gate-picker-2@x.com",
      dueAt: new Date(Date.now() + 86_400_000),
    });

    const { active } = await listMyItemsAs(requester);
    const entry = active.find((e) => e.kind === "request");
    expect(entry?.kind).toBe("request");
    if (entry?.kind === "request") {
      expect(entry.collectedBy?.email).toBe("gate-picker-2@x.com");
    }
  });
});

describe("transitionItem authority and line outcome", () => {
  /** An item reserved to the student, with an open line the item points at. */
  async function reserveToStudent() {
    const admin = await makeUser(`aa-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`ss-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: student.id,
      pickupBy: new Date(Date.now() + 86_400_000),
    });
    return { admin, student, item, line };
  }

  /** An item in requested, pointing at a still-pending line. */
  async function requestFromStudent() {
    const admin = await makeUser(`ap-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`sp-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    const { line } = await makeRequestLine(student.id, item.id);
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "requested",
      requestItemId: line.id,
      holderId: student.id,
    });
    return { admin, student, item, line };
  }

  it("lets a named authority past the staff gate", async () => {
    const { student, item, line } = await reserveToStudent();
    await transitionItem(student, {
      itemId: item.id,
      nextStatus: "available",
      authority: "self_cancel",
      lineDecision: { outcome: "cancelled", requestItemId: line.id },
    });
    const [after] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, item.id));
    expect(after.status).toBe("available");
  });

  it("tells nobody when the requester cancels their own line", async () => {
    const { student, item, line } = await reserveToStudent();
    await db.delete(notifications).where(eq(notifications.userId, student.id));
    await transitionItem(student, {
      itemId: item.id,
      nextStatus: "available",
      authority: "self_cancel",
      lineDecision: { outcome: "cancelled", requestItemId: line.id },
    });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(rows).toHaveLength(0);
  });

  it("still tells the holder when staff release the item", async () => {
    // The self_cancel suppression must not leak into the staff path, which is
    // the same transition by a different actor.
    const { admin, student, item } = await reserveToStudent();
    await db.delete(notifications).where(eq(notifications.userId, student.id));
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "available",
      comment: "Reclaimed for a class",
    });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("inventory_request_closed");
  });

  it("writes the review columns and the denial notice for a rejection", async () => {
    // A rejection acts on a pending line, so this cannot reuse
    // reserveToStudent, which leaves the line approved.
    const { admin, student, item, line } = await requestFromStudent();
    await db.delete(notifications).where(eq(notifications.userId, student.id));
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "available",
      lineDecision: { outcome: "rejected", requestItemId: line.id },
      comment: "Out of scope for this term",
    });

    const [closed] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(closed.status).toBe("rejected");
    expect(closed.reviewComment).toBe("Out of scope for this term");
    expect(closed.reviewedBy).toBe(admin.id);
    expect(closed.reviewedAt).not.toBeNull();
    expect(closed.closedReason).toBe("Out of scope for this term");

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, student.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("inventory_request_rejected");
    expect(rows[0].title).toMatch(/Request denied/);
    expect(rows[0].message).toBe("Out of scope for this term");
  });

  it("derives the line outcome when the caller names none", async () => {
    const { admin, item, line } = await reserveToStudent();
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [closed] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    // Reserved, never picked up, so cancelled rather than returned. The
    // review columns stay empty: this was a release, not a decision.
    expect(closed.status).toBe("cancelled");
    expect(closed.reviewedBy).toBeNull();
    expect(closed.reviewComment).toBeNull();
  });

  it("overrides a derivation that would have disagreed", async () => {
    // From checked_out the derivation yields "returned". Asking for
    // "cancelled" here is the only shape that can tell the override from its
    // absence: a reserved item derives "cancelled" either way, so a test
    // built on one would stay green with the whole feature deleted.
    const { admin, student, item, line } = await reserveToStudent();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });

    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "available",
      lineDecision: { outcome: "cancelled", requestItemId: line.id },
    });
    const [closed] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(closed.status).toBe("cancelled");
  });

  it("derives returned from a checkout when no decision is named", async () => {
    // The companion to the test above: same setup, no decision, and the
    // derivation must produce the value the override was overriding.
    const { admin, student, item, line } = await reserveToStudent();
    await transitionItem(admin, {
      itemId: item.id,
      nextStatus: "checked_out",
      requestItemId: line.id,
      holderId: student.id,
      dueAt: new Date(Date.now() + 86_400_000),
    });
    await transitionItem(admin, { itemId: item.id, nextStatus: "available" });
    const [closed] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, line.id));
    expect(closed.status).toBe("returned");
  });

  it("refuses a rejection of a line that is no longer pending", async () => {
    // The line is approved here, so rejecting it would overwrite the
    // approver's own review columns with a denial.
    const { admin, item, line } = await reserveToStudent();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "available",
        lineDecision: { outcome: "rejected", requestItemId: line.id },
        comment: "Changed my mind",
      })
    ).rejects.toThrow(/Only pending lines can be rejected/);
  });

  it("refuses a decision naming a line the item is not holding", async () => {
    const { admin, item } = await reserveToStudent();
    const other = await requestFromStudent();
    await expect(
      transitionItem(admin, {
        itemId: item.id,
        nextStatus: "available",
        lineDecision: { outcome: "cancelled", requestItemId: other.line.id },
      })
    ).rejects.toThrow(/not the one the item is holding/);
    // The stranger's line is untouched.
    const [untouched] = await db
      .select()
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, other.line.id));
    expect(untouched.status).toBe("pending");
    expect(untouched.closedAt).toBeNull();
  });
});

describe("retired visibility", () => {
  async function retiredAndActiveItems() {
    const admin = await makeUser(`ar-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`sr-${Date.now()}@x.com`, "user");
    const retired = await makeItem({ name: `Retired-${Date.now()}` });
    const active = await makeItem({ name: `Active-${Date.now()}` });
    await transitionItem(admin, { itemId: retired.id, nextStatus: "retired" });
    return { admin, student, retired, active };
  }

  const LIST_DEFAULTS = () => ({
    categories: [] as string[],
    q: "",
    retiredOnly: false,
    status: null,
  });

  it("keeps retired out of the admin listing by default", async () => {
    const { admin, retired, active } = await retiredAndActiveItems();
    const { rows } = await listAdminInventoryAs(admin, LIST_DEFAULTS());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(retired.id);
  });

  it("shows staff only the retired items when they ask", async () => {
    const { admin, retired, active } = await retiredAndActiveItems();
    const { rows } = await listAdminInventoryAs(admin, {
      ...LIST_DEFAULTS(),
      retiredOnly: true,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(retired.id);
    expect(ids).not.toContain(active.id);
  });

  it("never shows a non-staff viewer a retired item, even asking for it", async () => {
    // retiredOnly is not on the public wire schema at all; this covers the
    // second, independent guard, so both would have to fail for a leak.
    const { student, retired, active } = await retiredAndActiveItems();
    const { rows } = await listInventoryAs(student, {
      ...LIST_DEFAULTS(),
      page: 1,
      pageSize: 50,
      retiredOnly: true,
    } as Parameters<typeof listInventoryAs>[1]);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(retired.id);
  });

  it("lets staff open a retired item and refuses everyone else", async () => {
    const { admin, student, retired } = await retiredAndActiveItems();
    expect(await getInventoryItemAs(admin, { id: retired.id })).not.toBeNull();
    expect(await getInventoryItemAs(student, { id: retired.id })).toBeNull();
  });
});

describe("listInventoryRequestsAs", () => {
  it("returns one row per request line, not one per batch", async () => {
    const admin = await makeUser(`lir-a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`lir-s-${Date.now()}@x.com`, "user");
    const scope = await makeItem({ name: "Oscilloscope" });
    const iron = await makeItem({ name: "Soldering iron" });

    await addToCartAs(student, { itemId: scope.id });
    await addToCartAs(student, { itemId: iron.id });
    // One batch, two lines. The card layout rendered this as a single record;
    // the table has to see two.
    await submitCartAs(student, { note: "for demo" });

    const rows = await listInventoryRequestsAs(admin, {
      status: "pending",
      q: "",
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.item.name).sort()).toEqual([
      "Oscilloscope",
      "Soldering iron",
    ]);
  });

  it("filters to a single status", async () => {
    const admin = await makeUser(`lir-b-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`lir-c-${Date.now()}@x.com`, "user");
    const stays = await makeItem({ name: "Stays pending" });
    const moves = await makeItem({ name: "Gets approved" });

    await addToCartAs(student, { itemId: stays.id });
    await addToCartAs(student, { itemId: moves.id });
    await submitCartAs(student, { note: null });

    const pending = await listInventoryRequestsAs(admin, {
      status: "pending",
      q: "",
    });
    const target = pending.find((r) => r.item.id === moves.id);
    await approveRequestItemAs(admin, {
      requestItemId: target?.line.id ?? "",
      pickupBy: null,
    });

    expect(
      (await listInventoryRequestsAs(admin, { status: "pending", q: "" })).map(
        (r) => r.item.id
      )
    ).toEqual([stays.id]);
    expect(
      (await listInventoryRequestsAs(admin, { status: "approved", q: "" })).map(
        (r) => r.item.id
      )
    ).toEqual([moves.id]);
  });

  it("returns every status when status is all", async () => {
    const admin = await makeUser(`lir-d-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`lir-e-${Date.now()}@x.com`, "user");
    const kept = await makeItem({ name: "Kept pending" });
    const refused = await makeItem({ name: "Turned down" });

    await addToCartAs(student, { itemId: kept.id });
    await addToCartAs(student, { itemId: refused.id });
    await submitCartAs(student, { note: null });

    const pending = await listInventoryRequestsAs(admin, {
      status: "pending",
      q: "",
    });
    const target = pending.find((r) => r.item.id === refused.id);
    await rejectRequestItemAs(admin, {
      requestItemId: target?.line.id ?? "",
      reviewComment: "out of stock",
    });

    const all = await listInventoryRequestsAs(admin, { status: "all", q: "" });
    expect(all.map((r) => r.line.status).sort()).toEqual([
      "pending",
      "rejected",
    ]);
  });

  // Pins existing behavior rather than driving new: assertStaff was already
  // here, and this function had no coverage at all before this change.
  it("refuses a non-staff viewer", async () => {
    const student = await makeUser(`lir-g-${Date.now()}@x.com`, "user");
    await expect(
      listInventoryRequestsAs(student, { status: "pending", q: "" })
    ).rejects.toThrow();
    await expect(
      listInventoryRequestsAs(null, { status: "pending", q: "" })
    ).rejects.toThrow();
  });

  it("searches item name, requester name and requester email", async () => {
    const admin = await makeUser(`lir-f-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`grendel-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ name: "Beatrix Kiddo" })
      .where(eq(user.id, student.id));
    const wanted = await makeItem({ name: "Thermal camera" });
    const other = await makeItem({ name: "Bench vise" });

    await addToCartAs(student, { itemId: wanted.id });
    await addToCartAs(student, { itemId: other.id });
    await submitCartAs(student, { note: null });

    const byItem = await listInventoryRequestsAs(admin, {
      status: "pending",
      q: "thermal",
    });
    expect(byItem.map((r) => r.item.id)).toEqual([wanted.id]);

    // Requester name and email both match, so both lines come back.
    expect(
      await listInventoryRequestsAs(admin, { status: "pending", q: "beatrix" })
    ).toHaveLength(2);
    expect(
      await listInventoryRequestsAs(admin, { status: "pending", q: "grendel" })
    ).toHaveLength(2);
    expect(
      await listInventoryRequestsAs(admin, { status: "pending", q: "zzzz" })
    ).toHaveLength(0);
  });
});

describe("hasRequestHistory on the staff detail", () => {
  it("is false for an item nobody has requested", async () => {
    const admin = await makeUser(`hrh-a1-${Date.now()}@x.com`, "admin");
    const item = await makeItem();
    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    if (!view?.viewerIsStaff) {
      throw new Error("expected the staff branch");
    }
    expect(view.hasRequestHistory).toBe(false);
  });

  it("is true once a request line exists, whatever the line's state", async () => {
    const admin = await makeUser(`hrh-a2-${Date.now()}@x.com`, "admin");
    const holder = await makeUser(`hrh-h2-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await makeRequestLine(holder.id, item.id);
    const view = await getInventoryItemDetailAs(admin, { id: item.id });
    if (!view?.viewerIsStaff) {
      throw new Error("expected the staff branch");
    }
    expect(view.hasRequestHistory).toBe(true);
  });

  it("is not part of the public branch", async () => {
    const holder = await makeUser(`hrh-h3-${Date.now()}@x.com`, "user");
    const item = await makeItem();
    await makeRequestLine(holder.id, item.id);
    const view = await getInventoryItemDetailAs(null, { id: item.id });
    expect(view?.viewerIsStaff).toBe(false);
    expect(Object.keys(view ?? {})).not.toContain("hasRequestHistory");
  });
});

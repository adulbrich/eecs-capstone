import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
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
import { readSession, requireUser } from "#/lib/_internal/auth-guards";

type Viewer = { id: string; role?: string | null | undefined } | null;

export type ListInventoryInput = {
  q: string;
  status: "available" | "requested" | "reserved" | "checked_out" | "maintenance" | null;
  category: string | null;
  page: number;
  pageSize: number;
};

export type InventoryItemPublic = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  location: string | null;
  imageUrl: string | null;
  status: string;
  pickupBy: Date | null;
  dueAt: Date | null;
};

export type InventoryItemStaff = InventoryItemPublic & {
  serial: string | null;
  notes: string | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentRequestItemId: string | null;
};

function isStaff(viewer: Viewer): boolean {
  return viewer?.role === "admin" || viewer?.role === "instructor";
}

function stripForPublic(row: typeof inventoryItems.$inferSelect): InventoryItemPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    location: row.location,
    imageUrl: row.imageUrl,
    status: row.status,
    pickupBy: null,
    dueAt: null,
  };
}

function fullForStaff(row: typeof inventoryItems.$inferSelect): InventoryItemStaff {
  return {
    ...stripForPublic(row),
    serial: row.serial,
    notes: row.notes,
    currentHolderId: row.currentHolderId,
    currentHolderLabel: row.currentHolderLabel,
    currentRequestItemId: row.currentRequestItemId,
  };
}

export async function listInventoryAs(viewer: Viewer, data: ListInventoryInput) {
  const conditions = [ne(inventoryItems.status, "retired")];
  if (data.status) conditions.push(eq(inventoryItems.status, data.status));
  if (data.category) conditions.push(eq(inventoryItems.category, data.category));
  if (data.q) {
    conditions.push(
      or(
        sql`${inventoryItems.searchVector} @@ websearch_to_tsquery('english', ${data.q})`,
        ilike(inventoryItems.name, `%${data.q}%`),
      )!,
    );
  }
  const where = and(...conditions);
  const offset = (data.page - 1) * data.pageSize;

  const rows = await db
    .select({
      item: inventoryItems,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
    })
    .from(inventoryItems)
    .leftJoin(
      inventoryRequestItems,
      eq(inventoryItems.currentRequestItemId, inventoryRequestItems.id),
    )
    .where(where)
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(where);

  const mapped = rows.map((r) => {
    const base = isStaff(viewer) ? fullForStaff(r.item) : stripForPublic(r.item);
    return { ...base, pickupBy: r.pickupBy, dueAt: r.dueAt };
  });

  return {
    rows: mapped,
    total: count,
    page: data.page,
    pageSize: data.pageSize,
  };
}

export async function getInventoryItemAs(viewer: Viewer, data: { id: string }) {
  const [row] = await db
    .select({
      item: inventoryItems,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
    })
    .from(inventoryItems)
    .leftJoin(
      inventoryRequestItems,
      eq(inventoryItems.currentRequestItemId, inventoryRequestItems.id),
    )
    .where(eq(inventoryItems.id, data.id));
  if (!row) return null;
  if (row.item.status === "retired" && !isStaff(viewer)) return null;
  const base = isStaff(viewer) ? fullForStaff(row.item) : stripForPublic(row.item);
  return { ...base, pickupBy: row.pickupBy, dueAt: row.dueAt };
}

export async function listInventoryForCurrentUser(data: ListInventoryInput) {
  const session = await readSession();
  return listInventoryAs(session?.user ?? null, data);
}

export async function getInventoryItemForCurrentUser(data: { id: string }) {
  const session = await readSession();
  return getInventoryItemAs(session?.user ?? null, data);
}

export type CreateInventoryItemInput = {
  name: string;
  description: string | null;
  category: string | null;
  serial: string | null;
  location: string | null;
  notes: string | null;
  imageUrl: string | null;
};

function assertStaff(viewer: Viewer) {
  if (!isStaff(viewer)) throw new Error("Forbidden");
}

export async function createInventoryItemAs(
  viewer: Viewer,
  data: CreateInventoryItemInput,
) {
  assertStaff(viewer);
  const [row] = await db
    .insert(inventoryItems)
    .values({
      name: data.name,
      description: data.description,
      category: data.category,
      serial: data.serial,
      location: data.location,
      notes: data.notes,
      imageUrl: data.imageUrl,
    })
    .returning();
  return fullForStaff(row);
}

export type UpdateInventoryItemInput = CreateInventoryItemInput & {
  id: string;
};

const EDITABLE_FIELDS = [
  "name",
  "description",
  "category",
  "serial",
  "location",
  "notes",
  "imageUrl",
] as const;

export async function updateInventoryItemAs(
  viewer: Viewer,
  data: UpdateInventoryItemInput,
) {
  assertStaff(viewer);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id))
      .for("update");
    if (!before) throw new Error("Item not found");

    const changed: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      // Match projects.ts: normalize undefined to null on both sides and
      // compare with JSON.stringify so a wrapper passing `undefined`
      // for an unset field does not spuriously log a change.
      const oldVal = (before as Record<string, unknown>)[f] ?? null;
      const newVal = (data as Record<string, unknown>)[f] ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push(f);
        oldValues[f] = oldVal;
        newValues[f] = newVal;
      }
    }
    if (changed.length === 0) return fullForStaff(before);

    await tx
      .update(inventoryItems)
      .set({
        name: data.name,
        description: data.description,
        category: data.category,
        serial: data.serial,
        location: data.location,
        notes: data.notes,
        imageUrl: data.imageUrl,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, data.id));

    await tx.insert(inventoryItemEditLog).values({
      itemId: data.id,
      editorId: viewer!.id,
      changedFields: changed,
      oldValues,
      newValues,
    });

    const [after] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id));
    return fullForStaff(after);
  });
}

export async function hardDeleteInventoryItemAs(
  viewer: Viewer,
  data: { id: string; confirmName: string },
) {
  assertStaff(viewer);
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.id));
  if (!row) throw new Error("Item not found");
  if (row.name !== data.confirmName) {
    throw new Error("Name confirmation does not match");
  }
  if (row.status !== "available" && row.status !== "retired") {
    throw new Error("Hard delete only allowed when status is available or retired");
  }
  // Pre-check the RESTRICT FK on inventory_request_items.item_id so the
  // caller gets a friendly error instead of a raw Postgres 23503.
  const [historical] = await db
    .select({ id: inventoryRequestItems.id })
    .from(inventoryRequestItems)
    .where(eq(inventoryRequestItems.itemId, data.id))
    .limit(1);
  if (historical) {
    throw new Error(
      "Cannot hard delete; this item has historical request records. Retire it instead.",
    );
  }
  await db.delete(inventoryItems).where(eq(inventoryItems.id, data.id));
  return { ok: true as const };
}

export async function createInventoryItemForCurrentUser(
  data: CreateInventoryItemInput,
) {
  const viewer = await requireUser();
  return createInventoryItemAs(viewer, data);
}

export async function updateInventoryItemForCurrentUser(
  data: UpdateInventoryItemInput,
) {
  const viewer = await requireUser();
  return updateInventoryItemAs(viewer, data);
}

export async function hardDeleteInventoryItemForCurrentUser(data: {
  id: string;
  confirmName: string;
}) {
  const viewer = await requireUser();
  return hardDeleteInventoryItemAs(viewer, data);
}

export async function getCartAs(viewer: Viewer) {
  if (!viewer) throw new Error("Sign in required");
  const rows = await db
    .select({
      itemId: inventoryCartItems.itemId,
      addedAt: inventoryCartItems.addedAt,
      name: inventoryItems.name,
      imageUrl: inventoryItems.imageUrl,
      status: inventoryItems.status,
    })
    .from(inventoryCartItems)
    .innerJoin(
      inventoryItems,
      eq(inventoryCartItems.itemId, inventoryItems.id),
    )
    .where(eq(inventoryCartItems.userId, viewer.id))
    .orderBy(desc(inventoryCartItems.addedAt));
  return rows;
}

export async function addToCartAs(viewer: Viewer, data: { itemId: string }) {
  if (!viewer) throw new Error("Sign in required");
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.itemId));
  if (!item) throw new Error("Item not found");
  if (item.status !== "available") {
    throw new Error("Only available items can be added to the cart");
  }
  await db
    .insert(inventoryCartItems)
    .values({ userId: viewer.id, itemId: data.itemId })
    .onConflictDoNothing();
  return { ok: true as const };
}

export async function removeFromCartAs(
  viewer: Viewer,
  data: { itemId: string },
) {
  if (!viewer) throw new Error("Sign in required");
  await db
    .delete(inventoryCartItems)
    .where(
      and(
        eq(inventoryCartItems.userId, viewer.id),
        eq(inventoryCartItems.itemId, data.itemId),
      ),
    );
  return { ok: true as const };
}

export async function submitCartAs(
  viewer: Viewer,
  data: { note: string | null },
) {
  if (!viewer) throw new Error("Sign in required");

  return db.transaction(async (tx) => {
    const cartRows = await tx
      .select({
        itemId: inventoryCartItems.itemId,
      })
      .from(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, viewer.id));

    if (cartRows.length === 0) {
      throw new Error("Cart is empty");
    }

    // Phase 1: lock each cart item row and confirm it is still available.
    // This closes the TOCTOU window that an unlocked partition select would
    // leave open: a concurrent transaction could move the item out of
    // available before we acquire the lock, and the inline transition
    // below would otherwise silently overwrite that other party's hold.
    // Mirrors the overwrite guard in transitionItem.
    const skipped: { itemId: string; reason: "no_longer_available" }[] = [];
    const survivors: {
      itemId: string;
      oldStatus: (typeof inventoryItems.$inferSelect)["status"];
    }[] = [];
    for (const row of cartRows) {
      const [locked] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, row.itemId))
        .for("update");
      if (!locked || locked.status !== "available") {
        skipped.push({ itemId: row.itemId, reason: "no_longer_available" });
        continue;
      }
      survivors.push({ itemId: row.itemId, oldStatus: locked.status });
    }

    // Cart is always cleared once we have processed it.
    await tx
      .delete(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, viewer.id));

    if (survivors.length === 0) {
      return { requestId: null, submitted: [], skipped };
    }

    // Phase 2: only now insert the request envelope (so we never leave an
    // orphaned inventoryRequests row when every line races) and the lines.
    const [req] = await tx
      .insert(inventoryRequests)
      .values({ userId: viewer.id, note: data.note })
      .returning();

    const lines = await tx
      .insert(inventoryRequestItems)
      .values(
        survivors.map((s) => ({
          requestId: req.id,
          itemId: s.itemId,
          status: "pending" as const,
        })),
      )
      .returning();

    // transitionItem requires staff; do the requested transition inline here
    // (we are inside the same transaction and the survivor rows are already
    // locked, so atomicity and the overwrite guard hold).
    // No notification is emitted: self-submit does not need one (matches the
    // requested-transition arm of transitionItem.maybeNotify).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const survivor = survivors[i];
      await tx
        .update(inventoryItems)
        .set({
          status: "requested",
          currentHolderId: viewer.id,
          currentHolderLabel: null,
          currentRequestItemId: line.id,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, line.itemId));
      await tx.insert(inventoryItemStatusHistory).values({
        itemId: line.itemId,
        oldStatus: survivor.oldStatus,
        newStatus: "requested",
        changedBy: viewer.id,
        requestItemId: line.id,
        holderId: viewer.id,
      });
    }

    return {
      requestId: req.id,
      submitted: lines.map((l) => l.itemId),
      skipped,
    };
  });
}

export async function getCartForCurrentUser() {
  const viewer = await requireUser();
  return getCartAs(viewer);
}

export async function addToCartForCurrentUser(data: { itemId: string }) {
  const viewer = await requireUser();
  return addToCartAs(viewer, data);
}

export async function removeFromCartForCurrentUser(data: { itemId: string }) {
  const viewer = await requireUser();
  return removeFromCartAs(viewer, data);
}

export async function submitCartForCurrentUser(data: { note: string | null }) {
  const viewer = await requireUser();
  return submitCartAs(viewer, data);
}

const DEFAULT_PICKUP_DAYS = 7;

function defaultPickupBy(): Date {
  return new Date(Date.now() + DEFAULT_PICKUP_DAYS * 86400000);
}

export async function approveRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; pickupBy: Date | null },
) {
  assertStaff(viewer);
  const { transitionItem } = await import("./inventory-transitions");
  return db.transaction(async (tx) => {
    // Lock the line before reading and updating it so a concurrent cancel
    // cannot move it out of 'pending' between this read and the transition.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        requesterId: inventoryRequests.userId,
        status: inventoryRequestItems.status,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be approved");
    }
    await tx
      .update(inventoryRequestItems)
      .set({
        reviewedBy: viewer!.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, data.requestItemId));
    // Pass the open transaction so transitionItem joins the same atomic
    // unit; syncRequestItem will flip the line to 'approved' under the
    // same lock we already hold.
    await transitionItem(
      viewer!,
      {
        itemId: line.itemId,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: line.requesterId,
        pickupBy: data.pickupBy ?? defaultPickupBy(),
      },
      tx,
    );
    return { ok: true as const };
  });
}

export async function rejectRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; reviewComment: string },
) {
  assertStaff(viewer);
  if (!data.reviewComment.trim()) {
    throw new Error("Reject reason required");
  }
  return db.transaction(async (tx) => {
    // Join requester id into the initial line read so we do not need a
    // second SELECT just to find the notification recipient.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    await tx
      .update(inventoryRequestItems)
      .set({
        status: "rejected",
        reviewedBy: viewer!.id,
        reviewedAt: new Date(),
        reviewComment: data.reviewComment,
        closedAt: new Date(),
        closedBy: viewer!.id,
        closedReason: data.reviewComment,
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, data.requestItemId));
    await tx
      .update(inventoryItems)
      .set({
        status: "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, line.itemId));
    await tx.insert(inventoryItemStatusHistory).values({
      itemId: line.itemId,
      oldStatus: item.status,
      newStatus: "available",
      changedBy: viewer!.id,
      comment: data.reviewComment,
      requestItemId: line.id,
    });
    await tx.insert(notifications).values({
      userId: line.requesterId,
      type: "inventory_request_rejected",
      title: `Request denied: ${item.name}`,
      message: data.reviewComment,
      link: `/my/items?tab=history`,
    });
    return { ok: true as const };
  });
}

export async function cancelRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; note: string | null },
) {
  if (!viewer) throw new Error("Sign in required");
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) throw new Error("Request line not found");
    if (line.requesterId !== viewer.id) {
      throw new Error("Only the requester can cancel");
    }
    if (line.status !== "pending" && line.status !== "approved") {
      throw new Error("Line is not in a cancellable state");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    if (item.status === "checked_out") {
      throw new Error("Cannot cancel after checkout");
    }
    await tx
      .update(inventoryRequestItems)
      .set({
        status: "cancelled",
        closedAt: new Date(),
        closedBy: viewer.id,
        closedReason: data.note,
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, line.id));
    await tx
      .update(inventoryItems)
      .set({
        status: "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, line.itemId));
    await tx.insert(inventoryItemStatusHistory).values({
      itemId: line.itemId,
      oldStatus: item.status,
      newStatus: "available",
      changedBy: viewer.id,
      comment: data.note,
      requestItemId: line.id,
    });
    return { ok: true as const };
  });
}

export async function approveRequestItemForCurrentUser(data: {
  requestItemId: string;
  pickupBy: Date | null;
}) {
  const viewer = await requireUser();
  return approveRequestItemAs(viewer, data);
}

export async function rejectRequestItemForCurrentUser(data: {
  requestItemId: string;
  reviewComment: string;
}) {
  const viewer = await requireUser();
  return rejectRequestItemAs(viewer, data);
}

export async function cancelRequestItemForCurrentUser(data: {
  requestItemId: string;
  note: string | null;
}) {
  const viewer = await requireUser();
  return cancelRequestItemAs(viewer, data);
}

export async function listMyItemsAs(viewer: Viewer) {
  if (!viewer) throw new Error("Sign in required");
  // Notifications are a side-effect; never let them block the read.
  try {
    await recordOverdueNotificationsAs(viewer, { ownerId: viewer.id });
  } catch {
    // swallow; degraded notification recording must not 500 the page.
  }
  const [cart, active, history] = await Promise.all([
    getCartAs(viewer),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id),
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, ["pending", "approved"]),
        ),
      )
      .orderBy(desc(inventoryRequestItems.createdAt)),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id),
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id),
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, [
            "rejected",
            "cancelled",
            "returned",
          ]),
        ),
      )
      .orderBy(desc(inventoryRequestItems.updatedAt))
      .limit(50),
  ]);
  return { cart, active, history };
}

export async function listInventoryRequestsAs(
  viewer: Viewer,
  data: { tab: "pending" | "all" },
) {
  assertStaff(viewer);
  // No lazy overdue trigger here: notifications are for the requester, not
  // staff, and a global scan on every queue read is wasteful. The notification
  // fires when the requester reads /my/items.
  const statusFilter =
    data.tab === "pending"
      ? eq(inventoryRequestItems.status, "pending")
      : undefined;
  const rows = await db
    .select({
      line: inventoryRequestItems,
      item: inventoryItems,
      request: inventoryRequests,
      requesterEmail: user.email,
      requesterName: user.name,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id),
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id),
    )
    .innerJoin(user, eq(inventoryRequests.userId, user.id))
    .where(statusFilter)
    .orderBy(desc(inventoryRequests.createdAt));

  // Group by requestId so the admin queue can render one card per batch.
  const byRequest = new Map<
    string,
    {
      requestId: string;
      requester: { id: string; email: string; name: string | null };
      createdAt: Date;
      note: string | null;
      lines: typeof rows;
    }
  >();
  for (const r of rows) {
    const id = r.request.id;
    const existing = byRequest.get(id);
    if (existing) {
      existing.lines.push(r);
    } else {
      byRequest.set(id, {
        requestId: id,
        requester: {
          id: r.request.userId,
          email: r.requesterEmail,
          name: r.requesterName,
        },
        createdAt: r.request.createdAt,
        note: r.request.note,
        lines: [r],
      });
    }
  }
  return Array.from(byRequest.values());
}

export async function listMyItemsForCurrentUser() {
  const viewer = await requireUser();
  return listMyItemsAs(viewer);
}

export async function listInventoryRequestsForCurrentUser(data: {
  tab: "pending" | "all";
}) {
  const viewer = await requireUser();
  return listInventoryRequestsAs(viewer, data);
}

/**
 * Derive the two deadline flags for a row. `status` is the item-level
 * status, not the request line's: when a line is `approved` the item is
 * either `reserved` (pre-pickup) or `checked_out` (post-pickup), and we
 * key off that distinction to decide which deadline applies.
 */
export function deriveDeadlineFlags(row: {
  status: string;
  pickupBy: Date | null;
  dueAt: Date | null;
}) {
  const now = Date.now();
  return {
    pickupOverdue:
      row.status === "reserved" &&
      !!row.pickupBy &&
      row.pickupBy.getTime() < now,
    checkoutOverdue:
      row.status === "checked_out" &&
      !!row.dueAt &&
      row.dueAt.getTime() < now,
  };
}

/**
 * Lazy idempotent insert of overdue notifications. Scoped to a single owner
 * when {ownerId} is provided so the my-items read path does not scan every
 * approved line in the system.
 *
 * Idempotency: the partial unique index `notifications_overdue_unique_idx`
 * on (user_id, type, link) WHERE type IN (the two overdue types) lets
 * onConflictDoNothing skip duplicates. The target + where clause make the
 * arbiter explicit so adding another unique index on `notifications`
 * cannot silently swallow unrelated conflicts.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

function assertImageFile(file: unknown): asserts file is File {
  if (!(file instanceof File)) {
    throw new Error("Missing file");
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Unsupported image type");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`File too large (max ${MAX_INPUT_BYTES} bytes)`);
  }
}

export async function uploadInventoryImageAs(
  viewer: Viewer,
  form: FormData,
): Promise<{ key: string }> {
  assertStaff(viewer);
  const itemId = String(form.get("itemId") ?? "");
  if (!itemId) throw new Error("Missing itemId");
  const file = form.get("file");
  assertImageFile(file);

  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) throw new Error("Item not found");

  const input = Buffer.from(await file.arrayBuffer());
  const { processImage } = await import("#/lib/_internal/image-processing");
  const { buffer, contentType } = await processImage(input, {
    maxWidth: 1200,
    maxHeight: 1200,
  });

  const key = `inventory/${itemId}/${randomUUID()}.webp`;
  const { getObjectStorage } = await import("#/lib/_internal/storage");
  const storage = getObjectStorage();
  await storage.put(key, buffer, contentType);

  const previousKey = item.imageUrl;
  await db
    .update(inventoryItems)
    .set({ imageUrl: key, updatedAt: new Date() })
    .where(eq(inventoryItems.id, itemId));

  // Best-effort cleanup of the previous key (skip http(s) legacy URLs).
  if (
    previousKey &&
    !previousKey.startsWith("http://") &&
    !previousKey.startsWith("https://")
  ) {
    storage.delete(previousKey).catch((e) => {
      console.warn(`Failed to delete previous key ${previousKey}:`, e);
    });
  }

  return { key };
}

export async function uploadInventoryImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  return uploadInventoryImageAs(viewer, form);
}

export async function recordOverdueNotificationsAs(
  viewer: Viewer,
  opts: { ownerId?: string } = {},
) {
  if (!viewer) return;
  const conditions = [eq(inventoryRequestItems.status, "approved")];
  if (opts.ownerId) {
    conditions.push(eq(inventoryRequests.userId, opts.ownerId));
  }
  const rows = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
      requesterId: inventoryRequests.userId,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id),
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id),
    )
    .where(and(...conditions));

  const values: (typeof notifications.$inferInsert)[] = [];
  for (const r of rows) {
    const { pickupOverdue, checkoutOverdue } = deriveDeadlineFlags(r);
    if (pickupOverdue) {
      values.push({
        userId: r.requesterId,
        type: "inventory_pickup_overdue",
        title: `Pickup window passed: ${r.itemName}`,
        message: `Your reserved item is past its pickup window.`,
        link: `/inventory/${r.itemId}`,
      });
    }
    if (checkoutOverdue) {
      values.push({
        userId: r.requesterId,
        type: "inventory_checkout_overdue",
        title: `Overdue: ${r.itemName}`,
        message: `Your checked-out item is past its due date.`,
        link: `/inventory/${r.itemId}`,
      });
    }
  }
  if (values.length === 0) return;
  await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({
      target: [notifications.userId, notifications.type, notifications.link],
      where: sql`type IN ('inventory_pickup_overdue', 'inventory_checkout_overdue')`,
    });
}

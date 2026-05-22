import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryCartItems,
  inventoryItemEditLog,
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
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
    .select()
    .from(inventoryItems)
    .where(where)
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(where);

  return {
    rows: isStaff(viewer) ? rows.map(fullForStaff) : rows.map(stripForPublic),
    total: count,
    page: data.page,
    pageSize: data.pageSize,
  };
}

export async function getInventoryItemAs(viewer: Viewer, data: { id: string }) {
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.id));
  if (!row) return null;
  if (row.status === "retired" && !isStaff(viewer)) return null;
  return isStaff(viewer) ? fullForStaff(row) : stripForPublic(row);
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

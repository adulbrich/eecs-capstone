import { and, desc, eq } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryCartItems,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { Viewer } from "#/lib/viewer";

export async function getCartAs(viewer: Viewer) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  const rows = await db
    .select({
      itemId: inventoryCartItems.itemId,
      addedAt: inventoryCartItems.addedAt,
      name: inventoryItems.name,
      imageUrl: inventoryItems.imageUrl,
      status: inventoryItems.status,
    })
    .from(inventoryCartItems)
    .innerJoin(inventoryItems, eq(inventoryCartItems.itemId, inventoryItems.id))
    .where(eq(inventoryCartItems.userId, viewer.id))
    .orderBy(desc(inventoryCartItems.addedAt));
  return rows;
}

export async function addToCartAs(viewer: Viewer, data: { itemId: string }) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.itemId));
  if (!item) {
    throw new Error("Item not found");
  }
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
  data: { itemId: string }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  await db
    .delete(inventoryCartItems)
    .where(
      and(
        eq(inventoryCartItems.userId, viewer.id),
        eq(inventoryCartItems.itemId, data.itemId)
      )
    );
  return { ok: true as const };
}

export async function submitCartAs(
  viewer: Viewer,
  data: { note: string | null }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }

  return await db.transaction(async (tx) => {
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
    const survivors: { itemId: string }[] = [];
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
      // Only the id survives. The previous status was carried for the inline
      // history insert that used to live below; transitionItem reads it from
      // the row it locks itself.
      survivors.push({ itemId: row.itemId });
    }

    // Cart is always cleared once we have processed it.
    await tx
      .delete(inventoryCartItems)
      .where(eq(inventoryCartItems.userId, viewer.id));

    if (survivors.length === 0) {
      return { requestId: null, submitted: [], skipped };
    }

    // A guard, not a lookup. transitionItem derives the address from the
    // holder id itself, so this query's email is unused; what it buys is the
    // throw below.
    //
    // Without it, a submission by an account that no longer exists would
    // produce an account hold whose address resolved to null, which is the
    // one shape "a person hold always carries an address" forbids. No current
    // route reaches the throw, because a live session implies the row it
    // points at. Do not delete this as a redundant read.
    const [requester] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, viewer.id));
    if (!requester) {
      throw new Error(
        "Cannot submit a request for an account that no longer exists"
      );
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
        }))
      )
      .returning();

    // Each requested transition goes through the one writer, under the
    // self_request authority (the student is not staff) and on the open
    // transaction, so the locks taken above still hold. Re-locking a row this
    // transaction already owns is free, which is why sharing the writer costs
    // nothing here.
    //
    // No notification is emitted: the requested arm of maybeNotify has no
    // case, so self-submit stays silent as it always has.
    const { transitionItem } = await import("./inventory-transitions");
    for (const line of lines) {
      await transitionItem(
        viewer,
        {
          itemId: line.itemId,
          nextStatus: "requested",
          requestItemId: line.id,
          holderId: viewer.id,
          authority: "self_request",
        },
        tx
      );
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

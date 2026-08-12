import { randomUUID } from "node:crypto";
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
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
import { readSession, requireUser } from "#/lib/_internal/auth-guards";
import {
  type Hold,
  type HoldColumns,
  holdEmail,
  holdFromJoinedRow,
  holdFromStoredRow,
  holdName,
} from "#/lib/hold";
import { compareByDeadline } from "#/lib/inventory-deadlines";
import { overdueNotifications } from "#/lib/inventory-notifications";
import {
  canReadInventoryItem,
  type HoldItemView,
  holdItemView,
  type InventoryItemPublic,
  type InventoryItemStaff,
  type ItemCategory,
  type ItemStatus,
  type MyRequestLineView,
  myRequestLineView,
  publicItemView,
  staffItemView,
  visibleStatuses,
} from "#/lib/inventory-visibility";
import { assertStaff, isStaff } from "#/lib/viewer";
import { setInventoryItemCategoriesAs } from "./categories";
import type { Tx } from "./inventory-transitions";

type Viewer = { id: string; role?: string | null | undefined } | null;

export interface ListInventoryInput {
  categories: string[];
  page: number;
  pageSize: number;
  q: string;
  status:
    | "available"
    | "requested"
    | "reserved"
    | "checked_out"
    | "maintenance"
    | null;
}

/**
 * The hold on a read that joined the account. The precedence rules (the
 * joined account's address and name win, because someone who changed their
 * email or renamed their account is still the same holder) live in
 * `src/lib/hold.ts` and are unit tested there.
 */
function joinedHold(row: {
  holderEmail: string | null;
  holderName: string | null;
  item: HoldColumns;
}): Hold {
  return holdFromJoinedRow(row.item, {
    accountEmail: row.holderEmail,
    accountName: row.holderName,
  });
}

/**
 * The hold a write path can see: the stored columns as they stand, with no
 * account joined. Named rather than inlined so the difference from
 * `joinedHold` is visible at the call site. Create and update return their
 * item only so the caller can read back an id, and neither renders the
 * holder, so the unreconciled name costs nothing there.
 */
function storedHold(row: HoldColumns): Hold {
  return holdFromStoredRow(row);
}

/**
 * The conditions every inventory listing shares. Search is deliberately not
 * included: the public predicate matches name and the tsvector only, while
 * the staff predicate also reaches serial, label, location and holder, and
 * those must never become publicly searchable.
 */
function buildInventoryScope(
  viewer: Viewer,
  data: {
    categories: string[];
    retiredOnly?: boolean;
    status: ListInventoryInput["status"];
  }
): SQL[] {
  // Derived from the module rather than hard-coding `ne(status, "retired")`.
  // That literal was the half of the retired rule that disagreed with the
  // single-row gate: it hid retired from staff too, so staff could read a
  // retired item by URL and had no way to find one.
  const conditions: SQL[] = [
    inArray(
      inventoryItems.status,
      visibleStatuses(viewer, { retiredOnly: data.retiredOnly })
    ),
  ];
  if (data.status) {
    conditions.push(eq(inventoryItems.status, data.status));
  }
  if (data.categories.length > 0) {
    // All-match, not any-match: mirrors searchProjectsImpl
    // (src/server/_internal/search.ts:40-46). A subquery grouped by itemId
    // with count = the number of requested categories is the only shape
    // that discriminates "has every selected category" from "has at least
    // one of them" — a plain inArray on the join table would give the
    // any-match semantics this task explicitly rejects.
    const matching = db
      .select({ itemId: inventoryItemCategories.itemId })
      .from(inventoryItemCategories)
      .where(inArray(inventoryItemCategories.categoryId, data.categories))
      .groupBy(inventoryItemCategories.itemId)
      .having(sql`count(*) = ${data.categories.length}`);
    conditions.push(inArray(inventoryItems.id, matching));
  }
  return conditions;
}

/**
 * A correlated subquery, not a join: joining inventory_item_categories would
 * multiply each item row by its category count, corrupting both the row set
 * and the `count(*)` used for pagination. json_agg with coalesce keeps an
 * uncategorized item's array `[]` rather than dropping the row or leaving it
 * null.
 */
const categoriesForItem = sql<ItemCategory[]>`coalesce((
  SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
  FROM inventory_item_categories iic
  JOIN categories c ON c.id = iic.category_id
  WHERE iic.item_id = ${inventoryItems.id}
), '[]'::json)`;

export async function listInventoryAs(
  viewer: Viewer,
  data: ListInventoryInput
) {
  const conditions = buildInventoryScope(viewer, data);
  if (data.q) {
    const q = or(
      sql`${inventoryItems.searchVector} @@ websearch_to_tsquery('english', ${data.q})`,
      ilike(inventoryItems.name, `%${data.q}%`)
    );
    if (q) {
      conditions.push(q);
    }
  }
  const where = and(...conditions);
  const offset = (data.page - 1) * data.pageSize;

  const rows = await db
    .select({
      item: inventoryItems,
      holderName: user.name,
      holderEmail: user.email,
      categories: categoriesForItem,
    })
    .from(inventoryItems)
    .leftJoin(user, eq(inventoryItems.currentHolderId, user.id))
    .where(where)
    .orderBy(desc(inventoryItems.updatedAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(where);

  const mapped = rows.map((r) => {
    if (isStaff(viewer)) {
      return staffItemView(r.item, r.categories, joinedHold(r));
    }
    return publicItemView(r.item, r.categories);
  });

  return {
    rows: mapped,
    total: count,
    page: data.page,
    pageSize: data.pageSize,
  };
}

interface InventoryItemJoinedRow {
  categories: ItemCategory[];
  holderEmail: string | null;
  holderName: string | null;
  item: typeof inventoryItems.$inferSelect;
}

/**
 * The one query behind both the item detail reads, including the rule that a
 * retired item does not exist for anyone but staff. Extracted so the two
 * callers below map the same row through the same two gates instead of each
 * re-deriving the branch.
 */
async function loadInventoryItemRowFor(
  viewer: Viewer,
  id: string
): Promise<InventoryItemJoinedRow | null> {
  const [row] = await db
    .select({
      item: inventoryItems,
      holderName: user.name,
      holderEmail: user.email,
      categories: categoriesForItem,
    })
    .from(inventoryItems)
    .leftJoin(user, eq(inventoryItems.currentHolderId, user.id))
    .where(eq(inventoryItems.id, id));
  if (!row) {
    return null;
  }
  if (!canReadInventoryItem(row.item, viewer)) {
    return null;
  }
  return row;
}

function toStaffDetail(row: InventoryItemJoinedRow): InventoryItemStaff {
  return staffItemView(row.item, row.categories, joinedHold(row));
}

function toPublicDetail(row: InventoryItemJoinedRow): InventoryItemPublic {
  return publicItemView(row.item, row.categories);
}

export async function getInventoryItemAs(viewer: Viewer, data: { id: string }) {
  const row = await loadInventoryItemRowFor(viewer, data.id);
  if (!row) {
    return null;
  }
  return isStaff(viewer) ? toStaffDetail(row) : toPublicDetail(row);
}

export async function listInventoryForCurrentUser(data: ListInventoryInput) {
  const session = await readSession();
  return listInventoryAs(session?.user ?? null, data);
}

export interface ListAdminInventoryInput {
  categories: string[];
  q: string;
  /** Optional so existing callers compile; the wire schema always sends it. */
  retiredOnly?: boolean;
  status: ListInventoryInput["status"];
}

/**
 * The staff inventory listing: every matching row, unpaginated, because the
 * table sorts client-side and a page of 20 would make "sort by name" a lie.
 *
 * The search predicate is wider than the public one on purpose, reaching the
 * fields staff actually hunt by. It stays in this function rather than in the
 * shared scope so those staff-only fields cannot leak into public search.
 */
export async function listAdminInventoryAs(
  viewer: Viewer,
  data: ListAdminInventoryInput
) {
  assertStaff(viewer);
  const conditions = buildInventoryScope(viewer, data);
  const trimmed = data.q.trim();
  if (trimmed) {
    const like = `%${trimmed}%`;
    const match = or(
      sql`${inventoryItems.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(inventoryItems.name, like),
      ilike(inventoryItems.serial, like),
      ilike(inventoryItems.label, like),
      ilike(inventoryItems.location, like),
      ilike(user.name, like),
      ilike(user.email, like),
      // A hold assigned to a bare address or an ad-hoc label has no account
      // row to match, so search the item's own holder columns too. The stored
      // name earns its place here because the Holder column renders it: a
      // staff member can otherwise read a name off the table and find nothing
      // when they type it into the box above. Program is searchable so that
      // "CS 461" answers "what is out to that course", which is the question
      // the column exists to record.
      ilike(inventoryItems.currentHolderEmail, like),
      ilike(inventoryItems.currentHolderLabel, like),
      ilike(inventoryItems.currentHolderName, like),
      ilike(inventoryItems.currentHolderProgram, like)
    );
    if (match) {
      conditions.push(match);
    }
  }

  const rows = await db
    .select({
      categories: categoriesForItem,
      holderEmail: user.email,
      holderName: user.name,
      item: inventoryItems,
    })
    .from(inventoryItems)
    .leftJoin(user, eq(inventoryItems.currentHolderId, user.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryItems.updatedAt));

  return {
    rows: rows.map((r) => staffItemView(r.item, r.categories, joinedHold(r))),
  };
}

export async function listAdminInventoryForCurrentUser(
  data: ListAdminInventoryInput
) {
  const session = await readSession();
  return listAdminInventoryAs(session?.user ?? null, data);
}

export async function listInventoryCategoriesImpl() {
  // Restricted to categories actually in use, so the dropdown never offers a
  // filter that returns nothing. Reads through the join table now that an
  // item can carry more than one category; distinct on category id collapses
  // the fan-out from items with multiple categories. The domain filter is a
  // belt-and-suspenders guard, not a defense against something that can
  // happen today: nothing currently writes a project-domain category into
  // inventory_item_categories, but no database constraint stops it either,
  // so this keeps a future cross-domain row from surfacing in the public
  // inventory filter dropdown.
  const rows = await db
    .selectDistinct({ id: categories.id, name: categories.name })
    .from(inventoryItemCategories)
    .innerJoin(
      inventoryItems,
      eq(inventoryItemCategories.itemId, inventoryItems.id)
    )
    .innerJoin(
      categories,
      eq(inventoryItemCategories.categoryId, categories.id)
    )
    .where(
      and(
        eq(categories.domain, "inventory"),
        ne(inventoryItems.status, "retired")
      )
    )
    .orderBy(categories.name);
  return { categories: rows };
}

export async function getInventoryItemForCurrentUser(data: { id: string }) {
  const session = await readSession();
  return getInventoryItemAs(session?.user ?? null, data);
}

export interface CreateInventoryItemInput {
  categoryIds: string[];
  description: string | null;
  imageUrl: string | null;
  label: string | null;
  location: string | null;
  name: string;
  notes: string | null;
  serial: string | null;
}

/**
 * Resolves an item's categories to `{id, name}[]`, ordered by name.
 *
 * Takes an explicit executor (defaulting to the module `db`) so a caller
 * inside a transaction can pass `tx`: reaching for the module-level `db`
 * from inside `updateInventoryItemAs`'s transaction would check out a
 * second pooled connection while the first still holds the row's
 * `FOR UPDATE` lock, which is exactly the kind of transaction-boundary
 * change this task was told not to make.
 */
async function categoriesFor(
  itemId: string,
  executor: Tx | typeof db = db
): Promise<ItemCategory[]> {
  return await executor
    .select({ id: categories.id, name: categories.name })
    .from(inventoryItemCategories)
    .innerJoin(
      categories,
      eq(inventoryItemCategories.categoryId, categories.id)
    )
    .where(eq(inventoryItemCategories.itemId, itemId))
    .orderBy(categories.name);
}

export async function createInventoryItemAs(
  viewer: Viewer,
  data: CreateInventoryItemInput
) {
  assertStaff(viewer);
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryItems)
      .values({
        name: data.name,
        description: data.description,
        serial: data.serial,
        label: data.label,
        location: data.location,
        notes: data.notes,
        imageUrl: data.imageUrl,
      })
      .returning();
    // Written inside the same transaction as the item itself, so a failure
    // here rolls back the insert instead of leaving an item with no
    // categories.
    await setInventoryItemCategoriesAs(
      viewer,
      { itemId: row.id, categoryIds: data.categoryIds },
      tx
    );
    return staffItemView(row, await categoriesFor(row.id, tx), storedHold(row));
  });
}

export type UpdateInventoryItemInput = CreateInventoryItemInput & {
  id: string;
};

// `satisfies` (not a type annotation) so the array keeps its literal tuple
// type for the loop below, while a renamed or removed column here still
// fails the build: a drifted entry silently makes `changed` empty for an
// edit that only touched that field, hitting the early return below and
// discarding the whole update while the caller still sees a success.
// Categories are not in this list: they moved off inventory_items onto the
// join table and are diffed separately, below.
const EDITABLE_FIELDS = [
  "name",
  "description",
  "serial",
  "label",
  "location",
  "notes",
  "imageUrl",
] as const satisfies readonly (keyof typeof inventoryItems.$inferSelect)[];

export async function updateInventoryItemAs(
  viewer: Viewer,
  data: UpdateInventoryItemInput
) {
  assertStaff(viewer);
  return await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id))
      .for("update");
    if (!before) {
      throw new Error("Item not found");
    }

    const changed: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      // Match projects.ts: normalize undefined to null on both sides and
      // compare with JSON.stringify so a wrapper passing `undefined`
      // for an unset field does not spuriously log a change. `f` is one of
      // the literal EDITABLE_FIELDS keys (not a bare `string`), so both
      // reads below are real, checked property accesses rather than casts.
      const oldVal = before[f] ?? null;
      const newVal = data[f] ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changed.push(f);
        oldValues[f] = oldVal;
        newValues[f] = newVal;
      }
    }

    // Categories left EDITABLE_FIELDS's loop above along with the column, so
    // they need their own diff, computed before the early return: otherwise
    // a request that changes only categoryIds would compute changed.length
    // === 0 above and silently discard the category write entirely, the
    // same silent-write class the rest of this function guards against.
    // Logged as names, not ids, joined with "; ": the edit log previously
    // held readable category names and nothing renders it yet, so whoever
    // builds that view should not inherit opaque identifiers.
    const beforeCategories = await categoriesFor(data.id, tx);
    const beforeCategoryIds = beforeCategories.map((c) => c.id).sort();
    const afterCategoryIds = [...data.categoryIds].sort();
    const categoriesChanged =
      JSON.stringify(beforeCategoryIds) !== JSON.stringify(afterCategoryIds);
    if (categoriesChanged) {
      changed.push("categories");
      oldValues.categories = beforeCategories.map((c) => c.name).join("; ");
    }

    if (changed.length === 0) {
      return staffItemView(before, beforeCategories, storedHold(before));
    }

    await tx
      .update(inventoryItems)
      .set({
        name: data.name,
        description: data.description,
        serial: data.serial,
        label: data.label,
        location: data.location,
        notes: data.notes,
        imageUrl: data.imageUrl,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, data.id));

    let afterCategories = beforeCategories;
    if (categoriesChanged) {
      await setInventoryItemCategoriesAs(
        viewer,
        { itemId: data.id, categoryIds: data.categoryIds },
        tx
      );
      afterCategories = await categoriesFor(data.id, tx);
      newValues.categories = afterCategories.map((c) => c.name).join("; ");
    }

    await tx.insert(inventoryItemEditLog).values({
      itemId: data.id,
      editorId: viewer.id,
      changedFields: changed,
      oldValues,
      newValues,
    });

    const [after] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id));
    return staffItemView(after, afterCategories, storedHold(after));
  });
}

export async function hardDeleteInventoryItemAs(
  viewer: Viewer,
  data: { id: string; confirmName: string }
) {
  assertStaff(viewer);
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, data.id));
  if (!row) {
    throw new Error("Item not found");
  }
  if (row.name !== data.confirmName) {
    throw new Error("Name confirmation does not match");
  }
  if (row.status !== "available" && row.status !== "retired") {
    throw new Error(
      "Hard delete only allowed when status is available or retired"
    );
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
      "Cannot hard delete; this item has historical request records. Retire it instead."
    );
  }
  await db.delete(inventoryItems).where(eq(inventoryItems.id, data.id));
  return { ok: true as const };
}

export async function createInventoryItemForCurrentUser(
  data: CreateInventoryItemInput
) {
  const viewer = await requireUser();
  return createInventoryItemAs(viewer, data);
}

export async function updateInventoryItemForCurrentUser(
  data: UpdateInventoryItemInput
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

const DEFAULT_PICKUP_DAYS = 7;

function defaultPickupBy(): Date {
  return new Date(Date.now() + DEFAULT_PICKUP_DAYS * 86_400_000);
}

export async function approveRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; pickupBy: Date | null },
  externalTx?: Tx
) {
  assertStaff(viewer);
  const { transitionItem } = await import("./inventory-transitions");
  const run = async (tx: Tx) => {
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
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be approved");
    }
    await tx
      .update(inventoryRequestItems)
      .set({
        reviewedBy: viewer.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inventoryRequestItems.id, data.requestItemId));
    // Pass the open transaction so transitionItem joins the same atomic
    // unit; syncRequestItem will flip the line to 'approved' under the
    // same lock we already hold.
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "reserved",
        requestItemId: line.id,
        holderId: line.requesterId,
        pickupBy: data.pickupBy ?? defaultPickupBy(),
      },
      tx
    );
    return { ok: true as const };
  };
  // When the caller already has a transaction (bulk approve flow),
  // join it so a later failure rolls back earlier approves in the batch.
  if (externalTx) {
    return run(externalTx);
  }
  return db.transaction(run);
}

export async function rejectRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; reviewComment: string }
) {
  assertStaff(viewer);
  if (!data.reviewComment.trim()) {
    throw new Error("Reject reason required");
  }
  return await db.transaction(async (tx) => {
    // Locks the line and reads the item it belongs to. The requester is not
    // read here any more: transitionItem looks it up when it closes the line,
    // so that the denial reaches whoever asked even on a path that did not
    // come through this function.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
      })
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
    // The release, the line close, the history row and the denial notice all
    // happen inside transitionItem now. This function keeps only what is its
    // own: who may reject, and which line is eligible.
    const { transitionItem } = await import("./inventory-transitions");
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.reviewComment,
        lineDecision: { outcome: "rejected", requestItemId: line.id },
      },
      tx
    );
    return { ok: true as const };
  });
}

export async function cancelRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; note: string | null }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  return await db.transaction(async (tx) => {
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
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
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
    // self_cancel is what lets a requester past the staff gate, and it is the
    // reason no notification is emitted: the only person to tell is the one
    // who just clicked the button.
    const { transitionItem } = await import("./inventory-transitions");
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.note,
        authority: "self_cancel",
        lineDecision: { outcome: "cancelled", requestItemId: line.id },
      },
      tx
    );
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

/**
 * An entry in the Active tab.
 *
 * Only a hold carries the item as its subject, because only a hold has no
 * request line. A request carries its line plus the item's name and status: a
 * request's deadlines live on the line, and letting it carry the item's too
 * would put two different `pickupBy` values on one object.
 */
export type ActiveEntry =
  | {
      collectedBy: CollectedBy | null;
      itemName: string;
      itemStatus: ItemStatus;
      kind: "request";
      line: MyRequestLineView;
    }
  | { item: HoldItemView; kind: "hold" };

/**
 * A closed line. The item's current status and dates describe whoever has it
 * now, which is not this record, so only the name comes along.
 */
export interface HistoryEntry {
  collectedBy: CollectedBy | null;
  itemName: string;
  line: MyRequestLineView;
}

export async function listMyItemsAs(viewer: Viewer) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  // Notifications are a side-effect; never let them block the read. There is
  // no cron (see QUIRKS), so this read is genuinely the trigger, and a failure
  // here must not 500 the page.
  //
  // It is reported rather than discarded. A bare `catch {}` here meant that if
  // this stopped working, every overdue notification stopped with it and
  // nobody found out, because the page carried on looking fine.
  try {
    await recordOverdueNotificationsAs(viewer, { ownerId: viewer.id });
  } catch (error) {
    console.error(
      `Overdue notification recording failed for user ${viewer.id}`,
      error
    );
  }
  // Only a verified address may claim a hold: otherwise anyone could take
  // someone else's item by editing their own email in the profile form.
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, viewer.id));
  const verifiedEmail = account?.verified ? account.email : null;

  const [cart, activeLines, holds, history] = await Promise.all([
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
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id)
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, ["pending", "approved"])
        )
      )
      .orderBy(desc(inventoryRequestItems.createdAt)),
    db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .where(
        and(
          // The point of this condition was always "an item must not appear
          // twice on one person's page", not "a held item has no request".
          // Stated that way it also lets a teammate who collected someone
          // else's requested item see the hold they are actually carrying.
          //
          // The status filter has to be the same one the request half above
          // uses, or the two stop partitioning: an item pointing at a closed
          // line would be excluded here as a duplicate of a row that half
          // never returns, and would vanish from the tab entirely.
          notExists(
            db
              .select({ one: sql`1` })
              .from(inventoryRequestItems)
              .innerJoin(
                inventoryRequests,
                eq(inventoryRequestItems.requestId, inventoryRequests.id)
              )
              .where(
                and(
                  eq(
                    inventoryRequestItems.id,
                    inventoryItems.currentRequestItemId
                  ),
                  eq(inventoryRequests.userId, viewer.id),
                  inArray(inventoryRequestItems.status, ["pending", "approved"])
                )
              )
          ),
          inArray(inventoryItems.status, ["reserved", "checked_out"]),
          or(
            eq(inventoryItems.currentHolderId, viewer.id),
            verifiedEmail
              ? and(
                  // Never override an explicit account assignment.
                  isNull(inventoryItems.currentHolderId),
                  eq(inventoryItems.currentHolderEmail, verifiedEmail)
                )
              : undefined
          )
        )
      ),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id)
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, [
            "rejected",
            "cancelled",
            "returned",
          ])
        )
      )
      .orderBy(desc(inventoryRequestItems.updatedAt))
      .limit(50),
  ]);

  const collected = await collectedByForRequestItems([
    ...activeLines.map((r) => r.line.id),
    ...history.map((r) => r.line.id),
  ]);

  // Every row on this page belongs to the viewer as requester, so a collector
  // who is the viewer is the ordinary case, not news: drop it. A collector
  // identified only by an address that happens to be the viewer's own is the
  // same case with no resolved account. A collector with neither a name nor
  // an address to print (a label hold) has nothing worth showing either.
  const collectedByForViewer = (lineId: string): CollectedBy | null => {
    const collector = collected.get(lineId) ?? null;
    if (!collector) {
      return null;
    }
    const isViewer =
      collector.id === viewer.id ||
      (account?.email != null && collector.email === account.email);
    if (isViewer) {
      return null;
    }
    return collector.name || collector.email ? collector : null;
  };

  const active: ActiveEntry[] = [
    ...activeLines.map(
      (row): ActiveEntry => ({
        kind: "request",
        collectedBy: collectedByForViewer(row.line.id),
        itemName: row.item.name,
        itemStatus: row.item.status,
        line: myRequestLineView(row.line),
      })
    ),
    ...holds.map(
      (row): ActiveEntry => ({ kind: "hold", item: holdItemView(row.item) })
    ),
  ].sort(compareByDeadline);

  return {
    cart,
    active,
    history: history.map(
      (row): HistoryEntry => ({
        itemName: row.item.name,
        line: myRequestLineView(row.line),
        collectedBy: collectedByForViewer(row.line.id),
      })
    ),
  };
}

export interface CollectedBy {
  email: string | null;
  id: string | null;
  name: string | null;
}

/**
 * Who physically collected each request line, read off the checked_out row in
 * the status history.
 *
 * History is the record rather than a pair of picked_up_by columns on
 * inventory_request_items: transitionItem is already the single writer of
 * that table, so there is nothing to keep in sync, and the fact survives the
 * return, which clears the item's own holder columns.
 *
 * One DISTINCT ON for a whole page of lines, not one query per line. The
 * ORDER BY must lead with the same column as the DISTINCT ON; the createdAt
 * DESC that follows is what picks the most recent checkout when a line was
 * checked out more than once.
 */
export async function collectedByForRequestItems(
  lineIds: string[]
): Promise<Map<string, CollectedBy>> {
  if (lineIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([inventoryItemStatusHistory.requestItemId], {
      requestItemId: inventoryItemStatusHistory.requestItemId,
      holderId: inventoryItemStatusHistory.holderId,
      holderEmail: inventoryItemStatusHistory.holderEmail,
      holderName: inventoryItemStatusHistory.holderName,
      accountEmail: user.email,
      accountName: user.name,
    })
    .from(inventoryItemStatusHistory)
    .leftJoin(user, eq(inventoryItemStatusHistory.holderId, user.id))
    .where(
      and(
        eq(inventoryItemStatusHistory.newStatus, "checked_out"),
        inArray(inventoryItemStatusHistory.requestItemId, lineIds)
      )
    )
    .orderBy(
      inventoryItemStatusHistory.requestItemId,
      desc(inventoryItemStatusHistory.createdAt)
    );

  const map = new Map<string, CollectedBy>();
  for (const r of rows) {
    if (!r.requestItemId) {
      continue;
    }
    // The account wins over the stored values, which cover a collector who
    // had no account. Same reconciliation as every other joined read, so it
    // comes from the Hold module rather than being restated here.
    const hold = holdFromJoinedRow(
      {
        currentHolderId: r.holderId,
        currentHolderEmail: r.holderEmail,
        currentHolderLabel: null,
        currentHolderName: r.holderName,
        currentHolderProgram: null,
      },
      { accountEmail: r.accountEmail, accountName: r.accountName }
    );
    map.set(r.requestItemId, {
      id: r.holderId,
      email: holdEmail(hold),
      name: holdName(hold),
    });
  }
  return map;
}

export async function listInventoryRequestsAs(
  viewer: Viewer,
  data: { tab: "pending" | "all" }
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
      eq(inventoryRequestItems.requestId, inventoryRequests.id)
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id)
    )
    .innerJoin(user, eq(inventoryRequests.userId, user.id))
    .where(statusFilter)
    .orderBy(desc(inventoryRequests.createdAt));

  const collected = await collectedByForRequestItems(
    rows.map((r) => r.line.id)
  );
  const enriched = rows.map((r) => ({
    ...r,
    collectedBy: collected.get(r.line.id) ?? null,
  }));

  // Group by requestId so the admin queue can render one card per batch.
  const byRequest = new Map<
    string,
    {
      requestId: string;
      requester: { id: string; email: string; name: string | null };
      createdAt: Date;
      note: string | null;
      lines: typeof enriched;
    }
  >();
  for (const r of enriched) {
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

export async function getItemHistoryAs(
  viewer: Viewer,
  data: { itemId: string }
) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: inventoryItemStatusHistory.id,
      itemId: inventoryItemStatusHistory.itemId,
      oldStatus: inventoryItemStatusHistory.oldStatus,
      newStatus: inventoryItemStatusHistory.newStatus,
      comment: inventoryItemStatusHistory.comment,
      requestItemId: inventoryItemStatusHistory.requestItemId,
      holderId: inventoryItemStatusHistory.holderId,
      holderLabel: inventoryItemStatusHistory.holderLabel,
      holderEmail: inventoryItemStatusHistory.holderEmail,
      holderName: inventoryItemStatusHistory.holderName,
      holderProgram: inventoryItemStatusHistory.holderProgram,
      createdAt: inventoryItemStatusHistory.createdAt,
      changedById: user.id,
      changedByName: user.name,
      changedByEmail: user.email,
    })
    .from(inventoryItemStatusHistory)
    .innerJoin(user, eq(inventoryItemStatusHistory.changedBy, user.id))
    .where(eq(inventoryItemStatusHistory.itemId, data.itemId))
    .orderBy(desc(inventoryItemStatusHistory.createdAt));
  return rows;
}

/**
 * One call for the item detail page, so a public loader can render a staff
 * branch without touching `getItemHistoryAs`, which opens with `assertStaff`
 * and would throw for an anonymous viewer rather than degrade.
 *
 * `viewerIsStaff` is returned explicitly rather than inferred by the caller
 * from the presence of `notes` / `serial`: sniffing the payload shape would
 * silently invert the gate the day a field is added to the public shape.
 */
export type InventoryItemDetail =
  | {
      history: Awaited<ReturnType<typeof getItemHistoryAs>>;
      item: InventoryItemStaff;
      viewerIsStaff: true;
    }
  | { history: never[]; item: InventoryItemPublic; viewerIsStaff: false };

export async function getInventoryItemDetailAs(
  viewer: Viewer,
  data: { id: string }
): Promise<InventoryItemDetail | null> {
  const row = await loadInventoryItemRowFor(viewer, data.id);
  if (!row) {
    return null;
  }
  // Discriminated on `viewerIsStaff`, so a consumer that narrows on it gets
  // the staff fields and the history without a cast. Building each branch from
  // the row directly is what makes that sound: there is no wider value being
  // asserted down to a narrower type.
  if (isStaff(viewer)) {
    return {
      item: toStaffDetail(row),
      history: await getItemHistoryAs(viewer, { itemId: data.id }),
      viewerIsStaff: true,
    };
  }
  return { item: toPublicDetail(row), history: [], viewerIsStaff: false };
}

export async function getInventoryItemDetailForCurrentUser(data: {
  id: string;
}) {
  const session = await readSession();
  return getInventoryItemDetailAs(session?.user ?? null, data);
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
  form: FormData
): Promise<{ key: string }> {
  assertStaff(viewer);
  const itemId = String(form.get("itemId") ?? "");
  if (!itemId) {
    throw new Error("Missing itemId");
  }
  const file = form.get("file");
  assertImageFile(file);

  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) {
    throw new Error("Item not found");
  }

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

/**
 * Common shape both scans below normalize their rows to before the single
 * push loop. `userId` is nullable here on purpose: the hold scan's query
 * conditions already exclude unresolved holds (see below), but the type
 * stays honest about the column it came from until the explicit filter.
 */
interface OverdueCandidate {
  dueAt: Date | null;
  itemId: string;
  itemName: string;
  pickupBy: Date | null;
  status: string;
  userId: string | null;
}

export async function recordOverdueNotificationsAs(
  viewer: Viewer,
  opts: { ownerId?: string } = {}
) {
  if (!viewer) {
    return;
  }
  const conditions = [eq(inventoryRequestItems.status, "approved")];
  if (opts.ownerId) {
    conditions.push(eq(inventoryRequests.userId, opts.ownerId));
  }
  const requestRows: OverdueCandidate[] = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
      userId: inventoryRequests.userId,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id)
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id)
    )
    .where(and(...conditions));

  // The hold scan and the request scan used to be disjoint, because a held
  // item always had either a request line or a holder, never both meaningfully.
  // Now that a teammate can collect someone else's requested item, the two
  // deliberately overlap: the requester is accountable for the request and the
  // picker is holding the thing, so both are told. Restricted to holds with a
  // resolved account (current_holder_id IS NOT NULL): notifications.userId is
  // a foreign key, and an email-matched hold has no id to attribute a message
  // to. Resolving the address here would reintroduce, on a write path, the
  // impersonation risk the read path in listMyItemsAs guards against.
  const holdConditions = [
    isNotNull(inventoryItems.currentHolderId),
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
  ];
  if (opts.ownerId) {
    holdConditions.push(eq(inventoryItems.currentHolderId, opts.ownerId));
  }
  const holdRows: OverdueCandidate[] = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryItems.currentPickupBy,
      dueAt: inventoryItems.currentDueAt,
      userId: inventoryItems.currentHolderId,
    })
    .from(inventoryItems)
    .where(and(...holdConditions));

  // Belt and suspenders with the query-level isNotNull above: keep the
  // exclusion of unattributable rows visible here too, rather than trusting
  // the query alone to have filtered them out before they reach the push
  // loop that assumes a non-null userId.
  const candidates = [...requestRows, ...holdRows].filter(
    (r): r is OverdueCandidate & { userId: string } => r.userId !== null
  );

  // The rows these candidates are owed, including the dedupe: two scans that
  // deliberately overlap, so the same person can appear twice. The rule lives
  // in `src/lib/inventory-notifications.ts` and is unit tested there.
  const values = overdueNotifications(candidates);

  if (values.length === 0) {
    return;
  }
  await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({
      target: [notifications.userId, notifications.type, notifications.link],
      where: sql`type IN ('inventory_pickup_overdue', 'inventory_checkout_overdue')`,
    });
}

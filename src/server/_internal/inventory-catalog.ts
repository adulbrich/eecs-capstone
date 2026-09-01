import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
  categories,
  inventoryItemCategories,
  inventoryItemEditLog,
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  user,
} from "#/db/schema";
import { readSession, requireUser } from "#/lib/_internal/auth-guards";
import { diffRowFields } from "#/lib/edit-diff";
import {
  type Hold,
  type HoldColumns,
  holdFromJoinedRow,
  holdFromStoredRow,
} from "#/lib/hold";
import {
  canReadInventoryItem,
  type InventoryItemPublic,
  type InventoryItemStaff,
  type ItemCategory,
  publicItemView,
  staffItemView,
  visibleStatuses,
} from "#/lib/inventory-visibility";
import { assertStaff, isStaff, type Viewer } from "#/lib/viewer";
import type {
  CreateInventoryItemInput,
  ListAdminInventoryInput,
  ListInventoryInput,
  UpdateInventoryItemInput,
} from "../inventory";
import { setInventoryItemCategoriesAs } from "./categories";
import type { Tx } from "./inventory-transitions";

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
    // one of them"; a plain inArray on the join table would give the
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

export async function updateInventoryItemAs(
  viewer: Viewer,
  data: UpdateInventoryItemInput
) {
  assertStaff(viewer);
  const { replacedImage, view } = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, data.id))
      .for("update");
    if (!before) {
      throw new Error("Item not found");
    }

    // Typed against the table rather than as a loose record, because this
    // object is the only statement of which columns an edit may touch.
    // `diffRowFields` reads its keys and `.set()` writes them, so the two
    // cannot fall out of step.
    //
    // The hand-maintained list this replaced could, and nothing would have
    // said so: dropping any of description, serial, notes or imageUrl from
    // it left `npm run typecheck` and the whole integration suite green
    // while an edit touching only that field saved nothing and reported
    // success. That is the defect `diffRowFields` was written for on the
    // projects side.
    //
    // Categories are not here: they live on a join table rather than on
    // inventory_items, and are diffed separately below.
    const values: Partial<typeof inventoryItems.$inferSelect> = {
      name: data.name,
      description: data.description,
      serial: data.serial,
      label: data.label,
      location: data.location,
      notes: data.notes,
      imageUrl: data.imageUrl,
    };

    // Named for what the edit log calls them. The differ builds all three
    // fresh on every call, so the category arm below appends to them directly.
    const {
      changedFields: changed,
      newDiff: newValues,
      oldDiff: oldValues,
    } = diffRowFields(before, values);

    // Categories are outside that diff along with the column, so they need
    // their own, computed before the early return: otherwise
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
      return {
        replacedImage: null,
        view: staffItemView(before, beforeCategories, storedHold(before)),
      };
    }

    await tx
      .update(inventoryItems)
      .set({ ...values, updatedAt: new Date() })
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
    return {
      replacedImage: changed.includes("imageUrl") ? before.imageUrl : null,
      view: staffItemView(after, afterCategories, storedHold(after)),
    };
  });

  // After the transaction commits, never inside it: a rollback would otherwise
  // destroy the object the surviving row still points at. Guarded so an edit
  // that did not touch the image does not pull the S3 SDK into the request at
  // all, which is what `updateProjectAs` does for the same reason. See #126.
  if (replacedImage) {
    const { deleteOwnedObject, inventoryImageKeys } = await import(
      "#/lib/_internal/storage"
    );
    await deleteOwnedObject(replacedImage, inventoryImageKeys(data.id));
  }
  return view;
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
  // The row is gone, so nothing will ever reference the object again. Retire
  // is deliberately not here: a retired item keeps both its row and its photo.
  if (row.imageUrl) {
    const { deleteOwnedObject, inventoryImageKeys } = await import(
      "#/lib/_internal/storage"
    );
    await deleteOwnedObject(row.imageUrl, inventoryImageKeys(data.id));
  }
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

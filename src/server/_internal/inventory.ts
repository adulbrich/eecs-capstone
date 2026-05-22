import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "#/db";
import { inventoryItems } from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";

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

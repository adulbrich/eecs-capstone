import { Link } from "@tanstack/react-router";
import { defineAdminColumns } from "#/components/admin-data-table";
import type {
  InventoryItemPublic,
  ItemStatus,
} from "#/lib/inventory-visibility";
import { getPublicUrl } from "#/lib/storage";
import type { SortState } from "#/lib/table-state";
import { ListingAddToCart } from "./add-to-cart-button";
import { CategoryChip } from "./category-chip";
import { ImageOrFallback } from "./image-or-fallback";
import { InventoryStatusBadge } from "./inventory-status-badge";

/**
 * One row of the public inventory listing. `listInventory` hands staff a
 * wider row, but this table shows only what `publicItemView` names, so the
 * public shape is the type at both widths.
 */
export type InventoryListRow = InventoryItemPublic;

/**
 * Name, ascending. The server orders the listing by `updatedAt`, which is a
 * staff column, and the table must sort by one it shows.
 */
export const INVENTORY_TABLE_DEFAULT_SORT: SortState = {
  desc: false,
  id: "name",
};

/** The order an item actually moves through, as `/admin/inventory` sorts it. */
const STATUS_ORDER: Record<string, number> = {
  available: 0,
  requested: 1,
  reserved: 2,
  checked_out: 3,
  maintenance: 4,
};

/**
 * The public listing's table mode. Every column is a field `publicItemView`
 * returns; the two hold dates it also returns are deliberately absent (#193).
 */
export const INVENTORY_TABLE_COLUMNS = defineAdminColumns<InventoryListRow>()([
  {
    accessorFn: (row) => row.name,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={getPublicUrl(row.original.imageUrl)}
        />
        <Link
          className="hover:underline"
          params={{ itemId: row.original.id }}
          to="/inventory/$itemId"
        >
          {row.original.name}
        </Link>
        {/*
          Inside the name cell rather than an Actions column: the control
          renders nothing for an anonymous viewer or an unavailable item, and
          an empty column would be noise on the page they hit first.
        */}
        <ListingAddToCart
          className="ml-auto"
          itemId={row.original.id}
          status={row.original.status}
        />
      </div>
    ),
    cardHeader: true,
    enableHiding: false,
    header: "Name",
    id: "name",
  },
  {
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => (
      <InventoryStatusBadge status={row.original.status as ItemStatus} />
    ),
    header: "Status",
    id: "status",
    // Numeric, not text: the locale-compare default would compare String(n).
    sortingFn: "basic",
  },
  {
    cell: ({ row }) =>
      row.original.categories.length === 0 ? (
        "-"
      ) : (
        <div className="flex flex-wrap gap-1">
          {row.original.categories.map((category) => (
            <CategoryChip
              category={{ ...category, type: null }}
              key={category.id}
            />
          ))}
        </div>
      ),
    enableSorting: false,
    header: "Categories",
    id: "categories",
  },
  {
    cell: ({ row }) =>
      row.original.description ? (
        <div className="line-clamp-3 max-w-xs">{row.original.description}</div>
      ) : (
        "-"
      ),
    defaultHidden: true,
    enableSorting: false,
    header: "Description",
    id: "description",
  },
]);

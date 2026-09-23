import { Link } from "@tanstack/react-router";
import { defineAdminColumns } from "#/components/admin-data-table";
import type { InventoryItemPublic } from "#/lib/inventory-visibility";
import { getPublicUrl } from "#/lib/storage";
import type { SortState } from "#/lib/table-state";
import type { ItemStatus } from "#/lib/vocabularies";
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
 * Required by `useAdminTable` and inert: every column below is
 * `enableSorting: false` since #477, so `parseSort` returns this whatever the
 * URL says and the table renders the order `listInventory` returned. It used
 * to be a real `name asc` applied to the twenty rows on screen, so page two
 * restarted the alphabet and card and table view ordered the same URL
 * differently. The Sort select is the listing's one ordering. See
 * [ADR-0030](../../docs/adr/0030-one-ordering-control-on-the-public-listing.md).
 */
export const INVENTORY_TABLE_DEFAULT_SORT: SortState = {
  desc: false,
  id: "name",
};

/**
 * The public listing's table mode. Every column is a field `publicItemView`
 * returns; the two hold dates it also returns are deliberately absent (#193).
 */
export const INVENTORY_TABLE_COLUMNS = defineAdminColumns<InventoryListRow>()([
  {
    accessorFn: (row) => row.name,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 md:min-w-xs md:max-w-md">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={getPublicUrl(row.original.imageUrl)}
        />
        <Link
          className="min-w-0 hover:underline md:line-clamp-2 md:whitespace-normal"
          params={{ itemId: row.original.id }}
          title={row.original.name}
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
    enableSorting: false,
    header: "Name",
    id: "name",
  },
  {
    cell: ({ row }) => (
      <InventoryStatusBadge status={row.original.status as ItemStatus} />
    ),
    enableSorting: false,
    header: "Status",
    id: "status",
  },
  {
    cell: ({ row }) =>
      row.original.categories.length === 0 ? (
        "-"
      ) : (
        <div className="flex min-w-64 flex-wrap gap-1">
          {row.original.categories.map((category) => (
            <CategoryChip category={category} key={category.id} />
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
        <div className="line-clamp-3 max-w-xs md:whitespace-normal">
          {row.original.description}
        </div>
      ) : (
        "-"
      ),
    defaultHidden: true,
    enableSorting: false,
    header: "Description",
    id: "description",
  },
]);

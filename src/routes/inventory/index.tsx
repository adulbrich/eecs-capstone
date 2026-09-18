import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  AdminTableControls,
} from "#/components/admin-data-table";
import { BorrowListButton } from "#/components/borrow-list-button";
import { EmptyState } from "#/components/empty-state";
import { InventoryCard } from "#/components/inventory-card";
import {
  countActiveInventoryFilters,
  InventoryFilters,
  InventorySearchBar,
} from "#/components/inventory-filters";
import {
  INVENTORY_TABLE_COLUMNS,
  INVENTORY_TABLE_DEFAULT_SORT,
  type InventoryListRow,
} from "#/components/inventory-table-columns";
import { ListingLayout } from "#/components/listing-layout";
import { Button } from "#/components/ui/button";
import {
  Pagination,
  PaginationButton,
  PaginationStatus,
} from "#/components/ui/pagination";
import { ACTIVE_STATUSES, type ActiveStatus } from "#/lib/inventory-visibility";
import { PAGE_SIZE_DEFAULT } from "#/lib/pagination";
import { useAdminTable } from "#/lib/use-admin-table";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import { useSignedIn } from "#/lib/use-signed-in";
import type { ViewMode } from "#/lib/view-preference";
import { listInventory, listInventoryCategories } from "#/server/inventory";

const searchSchema = z.object({
  // Uncapped on purpose. The server clamps a long query to
  // SEARCH_QUERY_MAX and the hint line under the box says so, which it
  // can only do while the URL still carries what the reader typed. A
  // `.max()` here would have been a router error on a long link, which is
  // the shape #478 was about; a `.catch("")` would drop the search
  // silently instead.
  q: z.string().default(""),
  status: z.enum(ACTIVE_STATUSES).nullable().default(null),
  // A stale `?category=Electronics` link (pre-UUID, singular) fails
  // `.array().uuid()`; caught and treated as "no filter" rather than a
  // router error, per the brief: old links intentionally break as filters
  // but should not 500 the page.
  categories: z.array(z.string().uuid()).max(20).catch([]).default([]),
  page: z.number().int().positive().default(1),
  // Optional so a param-less visit is detectable; the stored preference then
  // seeds it. Absent from the URL defaults to "card" at render. A value the
  // enum no longer knows (`row`, until 2026-09-02) reads as absent rather than
  // as a router error, so a stale link renders the default.
  view: z.enum(["card", "table"]).optional().catch(undefined),
  // Table mode's column sort and visibility, owned by useAdminTable.
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/inventory/")({
  validateSearch: searchSchema,
  // Only the filter fields: the view mode, the column sort and the column
  // visibility are client state and must not re-run the loader.
  loaderDeps: ({ search }) => ({
    categories: search.categories,
    page: search.page,
    q: search.q,
    status: search.status,
  }),
  loader: async ({ deps }) => {
    const [data, { categories }] = await Promise.all([
      listInventory({
        data: {
          q: deps.q,
          status: deps.status,
          categories: deps.categories,
          page: deps.page,
          pageSize: PAGE_SIZE_DEFAULT,
        },
      }),
      listInventoryCategories(),
    ]);
    return { ...data, categories };
  },
  component: InventoryIndex,
});

function InventoryCards({
  q,
  rows,
  signedIn,
}: {
  q: string;
  rows: InventoryListRow[];
  signedIn: boolean;
}) {
  if (rows.length === 0) {
    // The place someone discovers the gap: the search found nothing, so the
    // ask carries the query into the first line's name. Hidden when signed
    // out, the same rule the two buttons on the title row follow.
    return (
      <EmptyState>
        No items match.
        {signedIn && (
          <>
            {" "}
            <Link
              className="text-brand-dark underline"
              search={{ q: q || undefined }}
              to="/inventory/request"
            >
              Ask for it anyway
            </Link>
            .
          </>
        )}
      </EmptyState>
    );
  }
  return (
    <div className="mt-6 flex max-w-4xl flex-col gap-3">
      {rows.map((it) => (
        <InventoryCard
          item={{ ...it, status: it.status as ActiveStatus }}
          key={it.id}
          signedIn={signedIn}
        />
      ))}
    </div>
  );
}

function InventoryIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/inventory/" });
  const view = search.view ?? "card";
  const seedView = useCallback(
    (next: ViewMode) =>
      navigate({ replace: true, search: (s) => ({ ...s, view: next }) }),
    [navigate]
  );
  useSeedViewFromStorage(search.view, seedView);
  // Stable, because useDebouncedDraft inside the filter bar keys its timer on
  // this callback: an inline arrow would re-arm the debounce on every render
  // of this page rather than on every keystroke.
  const onQChange = useCallback(
    (q: string) => {
      navigate({ search: (s) => ({ ...s, q, page: 1 }) });
    },
    [navigate]
  );
  const signedIn = useSignedIn();
  const data = Route.useLoaderData();
  // In the route, for the same reason as on /projects: the Columns menu is
  // in the search row, and `seedColumns` holds the column seed for table
  // view. Sorting is local to the page, as there.
  const { controlsProps, tableProps } = useAdminTable({
    columns: INVENTORY_TABLE_COLUMNS,
    defaultSort: INVENTORY_TABLE_DEFAULT_SORT,
    navigate,
    search,
    seedColumns: view === "table",
    storageKey: "public-inventory",
  });
  const filtered =
    search.q !== "" || search.status !== null || search.categories.length > 0;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <ListingLayout
      activeFilterCount={countActiveInventoryFilters({
        categories: search.categories,
        status: search.status,
      })}
      className="mx-auto max-w-4xl xl:max-w-7xl"
      filters={
        <InventoryFilters
          categories={data.categories}
          onCategoriesChange={(categories) =>
            navigate({ search: (s) => ({ ...s, categories, page: 1 }) })
          }
          onClear={() =>
            navigate({
              search: (s) => ({ ...s, categories: [], status: null, page: 1 }),
            })
          }
          onStatusChange={(status) =>
            navigate({ search: (s) => ({ ...s, status, page: 1 }) })
          }
          selectedCategories={search.categories}
          status={search.status}
        />
      }
      search={
        <InventorySearchBar
          onQChange={onQChange}
          onViewChange={(next) =>
            navigate({ search: (s) => ({ ...s, view: next }) })
          }
          q={search.q}
          view={view}
        />
      }
      tableControls={
        view === "table" ? (
          <AdminTableControls
            filtered={filtered}
            rowCount={data.rows.length}
            {...controlsProps}
          />
        ) : undefined
      }
      title={
        /* flex-wrap and ml-auto, as on /projects: at a phone width the two
           buttons drop under the heading, right-aligned, rather than
           pushing the page wider than the viewport (#297). */
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-semibold text-2xl">Inventory</h1>
          <div className="ml-auto flex items-center gap-2">
            {/* Same sign-in gate as its sibling: a visitor cannot ask. */}
            {signedIn && (
              <Button asChild size="sm" variant="outline">
                <Link to="/inventory/request">Request something else</Link>
              </Button>
            )}
            <BorrowListButton />
          </div>
        </div>
      }
    >
      {view === "table" ? (
        <AdminDataTable
          caption="Inventory"
          controls="listing"
          data={data.rows}
          emptyMessage="No items yet."
          filtered={filtered}
          getRowId={(row) => row.id}
          noMatchMessage="No items match."
          {...tableProps}
        />
      ) : (
        <InventoryCards q={search.q} rows={data.rows} signedIn={signedIn} />
      )}
      <Pagination className="max-w-4xl">
        <PaginationButton
          disabled={data.page <= 1}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page - 1 }) })
          }
        >
          Previous
        </PaginationButton>
        <PaginationStatus
          page={data.page}
          shown={data.rows.length}
          total={data.total}
          totalPages={totalPages}
        />
        <PaginationButton
          disabled={data.page >= totalPages}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page + 1 }) })
          }
        >
          Next
        </PaginationButton>
      </Pagination>
    </ListingLayout>
  );
}

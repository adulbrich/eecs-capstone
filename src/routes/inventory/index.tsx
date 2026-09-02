import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { AdminDataTable } from "#/components/admin-data-table";
import { EmptyState } from "#/components/empty-state";
import { InventoryCard } from "#/components/inventory-card";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";
import {
  INVENTORY_TABLE_COLUMNS,
  INVENTORY_TABLE_DEFAULT_SORT,
  type InventoryListRow,
} from "#/components/inventory-table-columns";
import {
  Pagination,
  PaginationButton,
  PaginationStatus,
} from "#/components/ui/pagination";
import { authClient } from "#/lib/auth-client";
import { useAdminTable } from "#/lib/use-admin-table";
import { useHasMounted } from "#/lib/use-has-mounted";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import type { ViewMode } from "#/lib/view-preference";
import { listInventory, listInventoryCategories } from "#/server/inventory";

type PublicStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance";

const searchSchema = z.object({
  q: z.string().default(""),
  status: z
    .enum(["available", "requested", "reserved", "checked_out", "maintenance"])
    .nullable()
    .default(null),
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

type Search = z.infer<typeof searchSchema>;

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
          pageSize: 20,
        },
      }),
      listInventoryCategories(),
    ]);
    return { ...data, categories };
  },
  component: InventoryIndex,
});

/**
 * Table mode. Its own component so `useAdminTable`, and the column seed
 * effect it runs, only exist while the table is on screen. Sorting is local
 * to the page, as on `/projects`.
 */
function InventoryTable({
  rows,
  search,
}: {
  rows: InventoryListRow[];
  search: Search;
}) {
  const navigate = useNavigate({ from: "/inventory/" });
  const { tableProps } = useAdminTable({
    columns: INVENTORY_TABLE_COLUMNS,
    defaultSort: INVENTORY_TABLE_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "public-inventory",
  });
  return (
    <AdminDataTable
      caption="Inventory"
      data={rows}
      emptyMessage="No items match."
      getRowId={(row) => row.id}
      {...tableProps}
    />
  );
}

function InventoryCards({
  rows,
  signedIn,
}: {
  rows: InventoryListRow[];
  signedIn: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState>No items match.</EmptyState>;
  }
  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
      {rows.map((it) => (
        <InventoryCard
          item={{ ...it, status: it.status as PublicStatus }}
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
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const data = Route.useLoaderData();

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  // Gated on mount so the server's signed-out render and the client's first
  // render agree; see useHasMounted.
  const signedIn = hasMounted && !!session?.user;
  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">Inventory</h1>
        <div className="mt-4">
          <InventoryFilterBar
            categories={data.categories}
            onCategoriesChange={(categories) =>
              navigate({ search: (s) => ({ ...s, categories, page: 1 }) })
            }
            onQChange={onQChange}
            onStatusChange={(status) =>
              navigate({ search: (s) => ({ ...s, status, page: 1 }) })
            }
            onViewChange={(next) =>
              navigate({ search: (s) => ({ ...s, view: next }) })
            }
            q={search.q}
            selectedCategories={search.categories}
            status={search.status}
            view={view}
          />
        </div>
      </div>
      {view === "table" ? (
        <InventoryTable rows={data.rows} search={search} />
      ) : (
        <InventoryCards rows={data.rows} signedIn={signedIn} />
      )}
      <Pagination className="mx-auto max-w-4xl">
        <PaginationButton
          disabled={data.page <= 1}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page - 1 }) })
          }
        >
          Previous
        </PaginationButton>
        <PaginationStatus page={data.page} totalPages={totalPages} />
        <PaginationButton
          disabled={data.page >= totalPages}
          onClick={() =>
            navigate({ search: (s) => ({ ...s, page: s.page + 1 }) })
          }
        >
          Next
        </PaginationButton>
      </Pagination>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { InventoryCard } from "#/components/inventory-card";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";
import {
  Pagination,
  PaginationButton,
  PaginationStatus,
} from "#/components/ui/pagination";
import { authClient } from "#/lib/auth-client";
import { useHasMounted } from "#/lib/use-has-mounted";
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
});

export const Route = createFileRoute("/inventory/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
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

function InventoryIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/inventory/" });
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
            q={search.q}
            selectedCategories={search.categories}
            status={search.status}
          />
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState>No items match.</EmptyState>
      ) : (
        <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
          {data.rows.map((it) => (
            <InventoryCard
              item={{ ...it, status: it.status as PublicStatus }}
              key={it.id}
              signedIn={signedIn}
            />
          ))}
        </div>
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

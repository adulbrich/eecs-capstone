import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { InventoryCard } from "#/components/inventory-card";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";
import { InventoryRow } from "#/components/inventory-row";
import { authClient } from "#/lib/auth-client";
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
  // Optional so a param-less visit is detectable; the stored preference then
  // seeds it. Absent from the URL defaults to "card" at render.
  view: z.enum(["card", "row"]).optional(),
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
  const view = search.view ?? "card";
  const seedView = useCallback(
    (next: ViewMode) =>
      navigate({ replace: true, search: (s) => ({ ...s, view: next }) }),
    [navigate]
  );
  useSeedViewFromStorage(search.view, seedView);
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
            onQChange={(q) =>
              navigate({ search: (s) => ({ ...s, q, page: 1 }) })
            }
            onStatusChange={(status) =>
              navigate({ search: (s) => ({ ...s, status, page: 1 }) })
            }
            onViewChange={(view) =>
              navigate({ search: (s) => ({ ...s, view }) })
            }
            q={search.q}
            selectedCategories={search.categories}
            status={search.status}
            view={view}
          />
        </div>
      </div>
      {(() => {
        if (data.rows.length === 0) {
          return <EmptyState>No items match.</EmptyState>;
        }
        if (view === "row") {
          return (
            <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
              {data.rows.map((it) => (
                <InventoryRow
                  item={{ ...it, status: it.status as PublicStatus }}
                  key={it.id}
                  signedIn={signedIn}
                />
              ))}
            </div>
          );
        }
        return (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {data.rows.map((it) => (
              <InventoryCard
                item={{ ...it, status: it.status as PublicStatus }}
                key={it.id}
                signedIn={signedIn}
              />
            ))}
          </div>
        );
      })()}
      <div className="mx-auto mt-6 flex max-w-4xl items-center justify-between text-sm">
        <button
          className={
            data.page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          disabled={data.page <= 1}
          onClick={() =>
            navigate({
              search: (s) => ({ ...s, page: Math.max(1, s.page - 1) }),
            })
          }
          type="button"
        >
          Previous
        </button>
        <span className="text-muted-foreground">
          Page {data.page} of {totalPages}
        </span>
        <button
          className={
            data.page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          disabled={data.page >= totalPages}
          onClick={() =>
            navigate({
              search: (s) => ({ ...s, page: Math.min(totalPages, s.page + 1) }),
            })
          }
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

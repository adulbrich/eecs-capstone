import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { InventoryCard } from "#/components/inventory-card";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";
import { InventoryRow } from "#/components/inventory-row";
import { authClient } from "#/lib/auth-client";
import {
  addToCart,
  listInventory,
  listInventoryCategories,
} from "#/server/inventory";

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
  category: z.string().nullable().default(null),
  view: z.enum(["card", "row"]).default("card"),
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
          category: deps.category,
          page: deps.page,
          pageSize: 24,
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
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const data = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <div className="mt-4">
        <InventoryFilterBar
          q={search.q}
          status={search.status}
          category={search.category}
          view={search.view}
          categories={data.categories}
          onQChange={(q) => navigate({ search: (s) => ({ ...s, q, page: 1 }) })}
          onStatusChange={(status) =>
            navigate({ search: (s) => ({ ...s, status, page: 1 }) })
          }
          onCategoryChange={(category) =>
            navigate({ search: (s) => ({ ...s, category, page: 1 }) })
          }
          onViewChange={(view) => navigate({ search: (s) => ({ ...s, view }) })}
        />
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-8 text-center text-muted-foreground">
          No items match.
        </p>
      ) : search.view === "row" ? (
        <ul className="mt-4 flex flex-col gap-2">
          {data.rows.map((it) => (
            <li key={it.id}>
              <InventoryRow
                item={{ ...it, status: it.status as PublicStatus }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.rows.map((it) => (
            <InventoryCard
              key={it.id}
              item={{ ...it, status: it.status as PublicStatus }}
              signedIn={!!session?.user}
              onAddToCart={async (itemId) => {
                await addToCart({ data: { itemId } });
                await qc.invalidateQueries();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

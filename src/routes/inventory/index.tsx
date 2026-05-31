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
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const data = Route.useLoaderData();

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const signedIn = !!session?.user;
  async function addItem(itemId: string) {
    await addToCart({ data: { itemId } });
    await qc.invalidateQueries();
  }

  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">Inventory</h1>
        <div className="mt-4">
          <InventoryFilterBar
            categories={data.categories}
            category={search.category}
            onCategoryChange={(category) =>
              navigate({ search: (s) => ({ ...s, category, page: 1 }) })
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
            status={search.status}
            view={search.view}
          />
        </div>
      </div>
      {(() => {
        if (data.rows.length === 0) {
          return (
            <p className="mt-8 text-center text-muted-foreground">
              No items match.
            </p>
          );
        }
        if (search.view === "row") {
          return (
            <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
              {data.rows.map((it) => (
                <InventoryRow
                  item={{ ...it, status: it.status as PublicStatus }}
                  key={it.id}
                  onAddToCart={addItem}
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
                onAddToCart={addItem}
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

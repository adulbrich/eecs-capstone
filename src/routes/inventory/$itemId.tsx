import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { HistoryRow } from "#/components/inventory-lifecycle-panel";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import {
  StaffInventoryPanel,
  type StaffPanelItem,
} from "#/components/staff-inventory-panel";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { addToCart, getInventoryItemDetail } from "#/server/inventory";

export const Route = createFileRoute("/inventory/$itemId")({
  head: () => ({ meta: [{ title: pageTitle("Inventory Item") }] }),
  loader: async ({ params }) => {
    const detail = await getInventoryItemDetail({
      data: { id: params.itemId },
    });
    if (!detail) {
      throw notFound();
    }
    return detail;
  },
  component: ItemDetail,
});

function ItemDetail() {
  const { item, history, viewerIsStaff } = Route.useLoaderData();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const img = getPublicUrl(item.imageUrl);
  const canAdd = item.status === "available" && !!session?.user;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="overflow-hidden rounded-lg bg-(--surface-sunken)">
          {img ? (
            <img alt="" className="h-full w-full object-cover" src={img} />
          ) : (
            <div className="aspect-square" />
          )}
        </div>
        <div>
          <h1 className="font-semibold text-2xl">{item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge
              showRetired={viewerIsStaff}
              status={
                item.status as
                  | "available"
                  | "requested"
                  | "reserved"
                  | "checked_out"
                  | "maintenance"
                  | "retired"
              }
            />
            {item.category && (
              <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground text-xs">
                {item.category}
              </span>
            )}
          </div>
          {item.description && (
            <p className="mt-4 whitespace-pre-wrap">{item.description}</p>
          )}
          <div className="mt-6">
            {canAdd ? (
              <Button
                onClick={async () => {
                  await addToCart({ data: { itemId: item.id } });
                  await qc.invalidateQueries();
                }}
              >
                Add to cart
              </Button>
            ) : (
              <p className="text-muted-foreground text-sm">
                {(() => {
                  if (!session?.user) {
                    return "Sign in to request items.";
                  }
                  if (item.status === "available") {
                    return null;
                  }
                  return "This item is not available right now.";
                })()}
              </p>
            )}
          </div>
        </div>
      </div>

      {viewerIsStaff && (
        <StaffInventoryPanel
          history={history as unknown as HistoryRow[]}
          item={item as unknown as StaffPanelItem}
        />
      )}
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";
import { addToCart, getInventoryItem } from "#/server/inventory";

export const Route = createFileRoute("/inventory/$itemId")({
  loader: async ({ params }) => {
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) throw notFound();
    return item;
  },
  component: ItemDetail,
});

function ItemDetail() {
  const item = Route.useLoaderData();
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const img = getPublicUrl(item.imageUrl);
  const canAdd = item.status === "available" && !!session?.user;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="overflow-hidden rounded-lg bg-(--surface-sunken)">
          {img ? (
            <img src={img} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <InventoryStatusBadge status={item.status as "available"} />
            {item.category && (
              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {item.category}
              </span>
            )}
          </div>
          {item.location && (
            <p className="mt-1 text-sm text-muted-foreground">{item.location}</p>
          )}
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
              <p className="text-sm text-muted-foreground">
                {!session?.user
                  ? "Sign in to request items."
                  : item.status === "available"
                    ? null
                    : "This item is not available right now."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

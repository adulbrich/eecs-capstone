import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AddToCartButton } from "#/components/add-to-cart-button";
import { CategoryChip } from "#/components/category-chip";
import { ExpectedBack } from "#/components/expected-back";
import { InventoryPrivatePanel } from "#/components/inventory-private-panel";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { StaffInventoryPanel } from "#/components/staff-inventory-panel";
import { authClient } from "#/lib/auth-client";
import { isUuid } from "#/lib/is-uuid";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { useHasMounted } from "#/lib/use-has-mounted";
import { getInventoryItemDetail } from "#/server/inventory";

export const Route = createFileRoute("/inventory/$itemId")({
  head: () => ({ meta: [{ title: pageTitle("Inventory Item") }] }),
  loader: async ({ params }) => {
    // The server function validates `id` as a UUID and throws a ZodError on
    // anything else, which would surface as a 500. A URL that cannot name an
    // item is a 404, so reject the shape here rather than letting the
    // validator decide the status code.
    if (!isUuid(params.itemId)) {
      throw notFound();
    }
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
  const detail = Route.useLoaderData();
  const { item } = detail;
  // The server has no session, so it always renders the signed-out branch.
  // Gating on mount rather than on the session's `isPending` makes the first
  // client render match it unconditionally: a cached session resolves
  // synchronously, so `isPending` can already be false on that first pass.
  const { data: session } = authClient.useSession();
  const hasMounted = useHasMounted();
  const img = getPublicUrl(item.imageUrl);
  const canAdd = item.status === "available" && !!session?.user;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Link
        className="text-muted-foreground text-sm hover:text-foreground hover:underline"
        to="/inventory"
      >
        ← All inventory
      </Link>

      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_1fr]">
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
              showRetired={detail.viewerIsStaff}
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
            {item.categories.map((category) => (
              <CategoryChip category={category} key={category.id} />
            ))}
          </div>
          {item.description && (
            <p className="mt-4 whitespace-pre-wrap">{item.description}</p>
          )}
          <div className="mt-6 min-h-9">
            {hasMounted ? (
              <CartAction
                canAdd={canAdd}
                itemId={item.id}
                signedIn={!!session?.user}
                status={item.status}
              />
            ) : null}
          </div>
          {/* Outside the mount gate: it depends on nothing about the session,
              and LocalTime is hydration-safe, so it can render on the server
              for the signed-out reader too. */}
          <ExpectedBack dueAt={item.dueAt} status={item.status} />
        </div>
      </div>

      {/* Private first, then staff: what the item is, then what is happening
          to it. Matches the project page's ordering of the same two regions. */}
      {detail.viewerIsStaff && (
        <>
          <InventoryPrivatePanel item={detail.item} />
          <StaffInventoryPanel
            hasRequestHistory={detail.hasRequestHistory}
            history={detail.history}
            item={detail.item}
          />
        </>
      )}
    </div>
  );
}

function CartAction({
  canAdd,
  itemId,
  signedIn,
  status,
}: {
  canAdd: boolean;
  itemId: string;
  signedIn: boolean;
  status: string;
}) {
  if (canAdd) {
    return <AddToCartButton itemId={itemId} size="default" variant="default" />;
  }
  if (!signedIn) {
    return (
      <p className="text-muted-foreground text-sm">Sign in to request items.</p>
    );
  }
  if (status === "available") {
    return null;
  }
  return (
    <p className="text-muted-foreground text-sm">
      This item is not available right now.
    </p>
  );
}

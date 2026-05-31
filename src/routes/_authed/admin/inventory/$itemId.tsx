import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router";
import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "#/components/inventory-lifecycle-panel";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { getInventoryItem, getItemHistory } from "#/server/inventory";

interface StaffItem {
  category: string | null;
  currentHolderId?: string | null;
  currentHolderLabel?: string | null;
  currentRequestItemId?: string | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  location: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
  status: string;
}

export const Route = createFileRoute("/_authed/admin/inventory/$itemId")({
  head: () => ({ meta: [{ title: pageTitle("Inventory Item") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ params }) => {
    const [item, history] = await Promise.all([
      getInventoryItem({ data: { id: params.itemId } }),
      getItemHistory({ data: { itemId: params.itemId } }),
    ]);
    if (!item) {
      throw notFound();
    }
    return { item, history };
  },
  component: AdminItemDetail,
});

function AdminItemDetail() {
  const { item: raw, history: rawHistory } = Route.useLoaderData();
  const item = raw as unknown as StaffItem;
  const history = rawHistory as unknown as HistoryRow[];
  const img = getPublicUrl(item.imageUrl);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/inventory">Inventory</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{item.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">{item.name}</h1>
        <Button asChild size="sm" variant="outline">
          <Link params={{ itemId: item.id }} to="/admin/inventory/$itemId/edit">
            Edit
          </Link>
        </Button>
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg bg-(--surface-sunken)">
            {img ? (
              <img alt="" className="h-full w-full object-cover" src={img} />
            ) : (
              <div className="aspect-square" />
            )}
          </div>

          <dl className="grid grid-cols-3 gap-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="col-span-2">
              <InventoryStatusBadge
                showRetired
                status={item.status as "available"}
              />
            </dd>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="col-span-2">{item.category ?? "-"}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="col-span-2">{item.location ?? "-"}</dd>
            <dt className="text-muted-foreground">Serial</dt>
            <dd className="col-span-2">{item.serial ?? "-"}</dd>
          </dl>

          {item.description && (
            <div>
              <p className="text-muted-foreground text-xs uppercase">
                Description
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {item.description}
              </p>
            </div>
          )}
          {item.notes && (
            <div>
              <p className="text-muted-foreground text-xs uppercase">
                Internal notes
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{item.notes}</p>
            </div>
          )}
        </div>

        <div>
          <InventoryLifecyclePanel
            history={history}
            item={{
              id: item.id,
              name: item.name,
              status: item.status,
              currentHolderId: item.currentHolderId ?? null,
              currentHolderLabel: item.currentHolderLabel ?? null,
              currentRequestItemId: item.currentRequestItemId ?? null,
            }}
          />
        </div>
      </div>
    </div>
  );
}

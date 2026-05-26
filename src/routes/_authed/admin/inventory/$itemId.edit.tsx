import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getInventoryItem } from "#/server/inventory";

type StaffItem = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  location: string | null;
  imageUrl: string | null;
  serial?: string | null;
  notes?: string | null;
};

export const Route = createFileRoute("/_authed/admin/inventory/$itemId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Inventory Item") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ params }) => {
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) throw notFound();
    return item;
  },
  component: EditInventoryItem,
});

function EditInventoryItem() {
  const navigate = useNavigate();
  const loaded = Route.useLoaderData() as unknown as StaffItem;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
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
            <BreadcrumbLink asChild>
              <Link
                to="/admin/inventory/$itemId"
                params={{ itemId: loaded.id }}
              >
                {loaded.name}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Edit</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 text-2xl font-semibold">Edit inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          itemId={loaded.id}
          initial={{
            name: loaded.name,
            description: loaded.description ?? "",
            category: loaded.category ?? "",
            serial: loaded.serial ?? "",
            location: loaded.location ?? "",
            notes: loaded.notes ?? "",
            imageUrl: loaded.imageUrl ?? "",
          }}
          submitLabel="Save"
          onSaved={(itemId) =>
            navigate({
              to: "/admin/inventory/$itemId",
              params: { itemId },
            })
          }
        />
      </div>
    </div>
  );
}

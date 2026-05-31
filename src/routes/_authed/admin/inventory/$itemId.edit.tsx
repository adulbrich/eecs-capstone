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

interface StaffItem {
  category: string | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  location: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
}

export const Route = createFileRoute("/_authed/admin/inventory/$itemId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Inventory Item") }] }),
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
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) {
      throw notFound();
    }
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
                params={{ itemId: loaded.id }}
                to="/admin/inventory/$itemId"
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
      <h1 className="mt-2 font-semibold text-2xl">Edit inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          initial={{
            name: loaded.name,
            description: loaded.description ?? "",
            category: loaded.category ?? "",
            serial: loaded.serial ?? "",
            location: loaded.location ?? "",
            notes: loaded.notes ?? "",
            imageUrl: loaded.imageUrl ?? "",
          }}
          itemId={loaded.id}
          onSaved={(itemId) =>
            navigate({
              to: "/admin/inventory/$itemId",
              params: { itemId },
            })
          }
          submitLabel="Save"
        />
      </div>
    </div>
  );
}

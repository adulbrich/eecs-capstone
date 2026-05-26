import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
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
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/admin/inventory/new")({
  head: () => ({ meta: [{ title: pageTitle("New Inventory Item") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  component: NewInventoryItem,
});

function NewInventoryItem() {
  const navigate = useNavigate();
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
            <BreadcrumbPage>New</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 text-2xl font-semibold">New inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          submitLabel="Create item"
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

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/_authed/inventory/new")({
  head: () => ({ meta: [{ title: pageTitle("New Inventory Item") }] }),
  // Same reasoning as the edit route: `_authed` only guarantees signed-in.
  // `createInventoryItemAs` asserts staff independently.
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
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
      <h1 className="font-semibold text-2xl">New inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          onSaved={(itemId) =>
            navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Create item"
        />
      </div>
    </div>
  );
}

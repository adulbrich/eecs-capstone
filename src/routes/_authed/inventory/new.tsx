import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { isStaff } from "#/lib/viewer";

/**
 * "Create item from this line" on the request queue opens this form
 * prefilled from a custom line and returns to the queue on save. Fulfill
 * links items and never creates one, so this form stays the one place an
 * item is made. Every field is optional and caught: a stale link renders
 * the empty form.
 */
const searchSchema = z.object({
  name: z.string().max(200).optional().catch(undefined),
  description: z.string().max(5000).optional().catch(undefined),
  from: z.enum(["requests"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/inventory/new")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("New Inventory Item") }] }),
  // Same reasoning as the edit route: `_authed` only guarantees signed-in.
  // `createInventoryItemAs` asserts staff independently.
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
      throw redirect({ to: "/" });
    }
  },
  component: NewInventoryItem,
});

function NewInventoryItem() {
  const navigate = useNavigate();
  const { description, from, name } = Route.useSearch();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">New inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          initial={{ description, name }}
          onSaved={(itemId) =>
            from === "requests"
              ? navigate({ to: "/admin/inventory/requests" })
              : navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Create item"
        />
      </div>
    </div>
  );
}

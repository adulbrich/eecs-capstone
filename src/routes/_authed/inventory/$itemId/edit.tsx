import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { isUuid } from "#/lib/is-uuid";
import { pageTitle } from "#/lib/page-title";
import {
  getInventoryItem,
  type InventoryItemPublic,
  type InventoryItemStaff,
} from "#/server/inventory";

/**
 * `getInventoryItem` returns a plain union (not a discriminated one): a
 * public and a staff shape that overlap structurally, so TypeScript cannot
 * narrow between them from a runtime check alone. `serial` exists only on
 * the staff shape, so testing for it is a real (compiler-checked) narrowing
 * instead of the double cast this used to be.
 */
function isStaffItem(
  item: InventoryItemPublic | InventoryItemStaff
): item is InventoryItemStaff {
  return "serial" in item;
}

export const Route = createFileRoute("/_authed/inventory/$itemId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Inventory Item") }] }),
  // `_authed` guarantees a signed-in user, not a staff one, and this URL is
  // now guessable from the public detail page. Defence in depth over
  // `updateInventoryItemAs`, which asserts staff on its own.
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
    // A param that cannot name an item is a 404, not a 500 from the server
    // function's Zod `.uuid()` validator.
    if (!isUuid(params.itemId)) {
      throw notFound();
    }
    const item = await getInventoryItem({ data: { id: params.itemId } });
    if (!item) {
      throw notFound();
    }
    if (!isStaffItem(item)) {
      // `beforeLoad` above already restricts this route to admin/instructor,
      // so `getInventoryItem` (which gates on the same session) cannot
      // actually return the public shape here. This only narrows the type
      // for the compiler; it is not a reachable runtime branch.
      throw notFound();
    }
    return { item };
  },
  component: EditInventoryItem,
});

function EditInventoryItem() {
  const navigate = useNavigate();
  const { item } = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Edit inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          initial={{
            name: item.name,
            description: item.description ?? "",
            categoryIds: item.categories.map((c) => c.id),
            serial: item.serial ?? "",
            label: item.label ?? "",
            location: item.location ?? "",
            notes: item.notes ?? "",
            imageUrl: item.imageUrl ?? "",
          }}
          itemId={item.id}
          onSaved={(itemId) =>
            navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Save"
        />
      </div>
    </div>
  );
}

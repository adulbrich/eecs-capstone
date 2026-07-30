import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { InventoryForm } from "#/components/inventory-form";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getInventoryItem } from "#/server/inventory";

interface StaffItem {
  category: string | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  label?: string | null;
  location: string | null;
  name: string;
  notes?: string | null;
  serial?: string | null;
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
      <h1 className="font-semibold text-2xl">Edit inventory item</h1>
      <div className="mt-6">
        <InventoryForm
          initial={{
            name: loaded.name,
            description: loaded.description ?? "",
            category: loaded.category ?? "",
            serial: loaded.serial ?? "",
            label: loaded.label ?? "",
            location: loaded.location ?? "",
            notes: loaded.notes ?? "",
            imageUrl: loaded.imageUrl ?? "",
          }}
          itemId={loaded.id}
          onSaved={(itemId) =>
            navigate({ to: "/inventory/$itemId", params: { itemId } })
          }
          submitLabel="Save"
        />
      </div>
    </div>
  );
}

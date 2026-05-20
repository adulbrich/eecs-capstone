import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import {
  createCategory,
  listCategories,
  listCategoryTypes,
} from "#/server/categories";

export const Route = createFileRoute("/_authed/admin/categories/")({
  head: () => ({ meta: [{ title: pageTitle("Categories") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => {
    const [{ rows }, { types }] = await Promise.all([
      listCategories({ data: {} }),
      listCategoryTypes(),
    ]);
    return { rows, types };
  },
  component: CategoriesAdmin,
});

function CategoriesAdmin() {
  const router = useRouter();
  const { rows, types } = Route.useLoaderData();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createCategory({ data: { name, type } });
      setName("");
      setType("");
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Admin: categories</h1>

      <form onSubmit={onCreate} className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-40"
          />
        </div>
        <div>
          <Label htmlFor="cat-type">Type</Label>
          <Input
            id="cat-type"
            list="cat-type-options"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            placeholder="technology, industry, ..."
            className="mt-1 w-48"
          />
          <datalist id="cat-type-options">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <Button type="submit" size="sm">
          Create
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <AdminTable columns={["Name", "Type", ""]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td data-label="Name" className="border border-border p-2">
              {c.name}
            </td>
            <td
              data-label="Type"
              className="border border-border p-2 text-muted-foreground"
            >
              {c.type}
            </td>
            <td className="border border-border p-2">
              <Link
                to="/admin/categories/$categoryId"
                params={{ categoryId: c.id }}
              >
                Edit
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}

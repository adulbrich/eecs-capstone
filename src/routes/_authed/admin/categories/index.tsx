import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { getSession } from "#/lib/auth-guards";
import {
  createCategory,
  listCategories,
  listCategoryTypes,
} from "#/server/categories";

export const Route = createFileRoute("/_authed/admin/categories/")({
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
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: categories</h1>

      <form onSubmit={onCreate} className="mt-6 flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor="cat-name"
            className="block text-xs font-medium text-neutral-500"
          >
            Name
          </label>
          <input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 border p-2"
          />
        </div>
        <div>
          <label
            htmlFor="cat-type"
            className="block text-xs font-medium text-neutral-500"
          >
            Type
          </label>
          <input
            id="cat-type"
            list="cat-type-options"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
            className="mt-1 border p-2"
            placeholder="technology, industry, ..."
          />
          <datalist id="cat-type-options">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <button type="submit" className="bg-black px-3 py-2 text-sm text-white">
          Create
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <AdminTable columns={["Name", "Type", ""]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {c.name}
            </td>
            <td className="border border-neutral-200 p-2 text-neutral-500 dark:border-neutral-800">
              {c.type}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              <Link
                to="/admin/categories/$categoryId"
                params={{ categoryId: c.id }}
                className="text-blue-700 hover:underline"
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

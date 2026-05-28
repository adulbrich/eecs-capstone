import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { CategoryTypeCombobox } from "#/components/category-type-combobox";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import {
  deleteCategory,
  getCategory,
  listCategoryTypes,
  updateCategory,
} from "#/server/categories";

export const Route = createFileRoute("/_authed/admin/categories/$categoryId")({
  head: () => ({ meta: [{ title: pageTitle("Edit Category") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ params }) => {
    const [{ category }, { types }] = await Promise.all([
      getCategory({ data: { id: params.categoryId } }),
      listCategoryTypes(),
    ]);
    return { category, types };
  },
  component: CategoryEdit,
});

function CategoryEdit() {
  const navigate = useNavigate();
  const { category, types } = Route.useLoaderData();
  const [name, setName] = useState(category.name);
  const [type, setType] = useState(category.type);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateCategory({ data: { id: category.id, name, type } });
      navigate({ to: "/admin/categories" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete() {
    if (
      !confirm(
        `Delete category "${category.name}"? Projects tagged with it will lose the tag.`,
      )
    )
      return;
    setError(null);
    try {
      await deleteCategory({ data: { id: category.id } });
      navigate({ to: "/admin/categories" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 md:p-8">
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
              <Link to="/admin/categories">Categories</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{category.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 text-2xl font-semibold">Edit category</h1>
      <form onSubmit={onSave} className="mt-6 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cat-type">Type</Label>
          <CategoryTypeCombobox
            id="cat-type"
            value={type}
            onChange={setType}
            types={types}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}

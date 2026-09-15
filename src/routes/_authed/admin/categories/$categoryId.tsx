import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  CATEGORY_FIELD_DESCRIPTION,
  CategoryTypeCombobox,
} from "#/components/category-type-combobox";
import { ConfirmDialog } from "#/components/confirm-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { useAction } from "#/lib/use-action";
import { isStaff } from "#/lib/viewer";
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
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
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
  const isProject = category.domain === "project";
  const [name, setName] = useState(category.name);
  const [type, setType] = useState(category.type ?? "");
  const { busy, error, run } = useAction({ fallback: "Save failed" });

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      if (isProject) {
        await updateCategory({
          data: { id: category.id, domain: "project", name, type },
        });
      } else {
        await updateCategory({
          data: { id: category.id, domain: "inventory", name, type: null },
        });
      }
      toast.success("Category saved.");
      navigate({ search: { tab: category.domain }, to: "/admin/categories" });
    });
  }

  // ConfirmDialog owns the flight and the refusal (#410).
  async function onDelete() {
    await deleteCategory({ data: { id: category.id } });
    navigate({ search: { tab: category.domain }, to: "/admin/categories" });
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
      <h1 className="mt-2 font-semibold text-2xl">Edit category</h1>
      <form className="mt-6 space-y-3" onSubmit={onSave}>
        {/* Same order and descriptions as the New category dialog (#374). */}
        {isProject && (
          <div className="space-y-1.5">
            <Label htmlFor="cat-type">Type</Label>
            <p
              className="text-muted-foreground text-xs"
              id="cat-type-description"
            >
              {CATEGORY_FIELD_DESCRIPTION.type}
            </p>
            <CategoryTypeCombobox
              describedBy="cat-type-description"
              id="cat-type"
              onChange={setType}
              types={types}
              value={type}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="cat-name">Name</Label>
          {isProject && (
            <p
              className="text-muted-foreground text-xs"
              id="cat-name-description"
            >
              {CATEGORY_FIELD_DESCRIPTION.name}
            </p>
          )}
          <Input
            aria-describedby={isProject ? "cat-name-description" : undefined}
            id="cat-name"
            onChange={(e) => setName(e.target.value)}
            required
            value={name}
          />
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
          <ConfirmDialog
            description="It will be removed from any projects and inventory items that use it. Those projects and items are unaffected otherwise."
            onConfirm={onDelete}
            title={`Delete category "${category.name}"?`}
          >
            <Button type="button" variant="destructive">
              Delete
            </Button>
          </ConfirmDialog>
        </div>
        <FieldError message={error} />
      </form>
    </div>
  );
}

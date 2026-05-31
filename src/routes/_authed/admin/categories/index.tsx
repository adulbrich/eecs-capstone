import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
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
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Categories</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">Categories</h1>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild>
            <Button size="sm">+ New category</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New category</DialogTitle>
              <DialogDescription>
                Add a category and assign it a type. Pick an existing type or
                create a new one.
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={onCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  onChange={(e) => setName(e.target.value)}
                  required
                  value={name}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="cat-type">Type</Label>
                <CategoryTypeCombobox
                  id="cat-type"
                  onChange={setType}
                  types={types}
                  value={type}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <DialogFooter>
                <Button disabled={!(name && type)} type="submit">
                  Create category
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AdminTable columns={["Name", "Type", ""]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td className="border border-border p-2" data-label="Name">
              {c.name}
            </td>
            <td
              className="border border-border p-2 text-muted-foreground"
              data-label="Type"
            >
              {c.type}
            </td>
            <td className="border border-border p-2">
              <Link
                params={{ categoryId: c.id }}
                to="/admin/categories/$categoryId"
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

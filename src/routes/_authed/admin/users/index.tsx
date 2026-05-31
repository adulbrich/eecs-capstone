import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdminTable } from "#/components/admin-table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { listUsers } from "#/server/users";

const ROLES = ["user", "instructor", "admin"] as const;

const searchSchema = z.object({
  q: z.string().default(""),
  role: z.enum(ROLES).nullable().default(null),
  includeBanned: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
});

export const Route = createFileRoute("/_authed/admin/users/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Users") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (session.user.role !== "admin") {
      throw redirect({ to: "/admin" });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    await listUsers({
      data: {
        q: deps.q,
        role: deps.role,
        includeBanned: deps.includeBanned,
        page: deps.page,
        pageSize: 20,
      },
    }),
  component: UsersAdmin,
});

function UsersAdmin() {
  const navigate = useNavigate({ from: "/admin/users/" });
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const { q, role, includeBanned } = Route.useSearch();
  const [qDraft, setQDraft] = useState(q);

  useEffect(() => setQDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) {
        void navigate({
          search: (prev) => ({ ...prev, q: qDraft, page: 1 }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, q, navigate]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
            <BreadcrumbPage>Users</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Users</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="user-search">Search</Label>
          <Input
            className="mt-1 w-48"
            id="user-search"
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Email or name"
            type="search"
            value={qDraft}
          />
        </div>
        <div>
          <Label htmlFor="user-role">Role</Label>
          <Select
            onValueChange={(v) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  role: (v === "_all_" ? null : v) as
                    | (typeof ROLES)[number]
                    | null,
                  page: 1,
                }),
              })
            }
            value={role ?? "_all_"}
          >
            <SelectTrigger className="mt-1 w-36" id="user-role">
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Label className="font-normal">
          <Checkbox
            checked={includeBanned}
            onCheckedChange={(checked) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  includeBanned: checked === true,
                  page: 1,
                }),
              })
            }
          />
          Include banned
        </Label>
      </div>

      <AdminTable columns={["Email", "Name", "Role", "Banned", ""]}>
        {rows.map((u) => (
          <tr key={u.id}>
            <td className="border border-border p-2" data-label="Email">
              {u.email}
            </td>
            <td className="border border-border p-2" data-label="Name">
              {u.name ?? "(none)"}
            </td>
            <td className="border border-border p-2" data-label="Role">
              {u.role}
            </td>
            <td className="border border-border p-2" data-label="Banned">
              {u.banned ? "yes" : ""}
            </td>
            <td className="border border-border p-2">
              <Link params={{ userId: u.id }} to="/admin/users/$userId">
                Manage
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          className={
            page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          search={(prev) => ({ ...prev, page: Math.max(1, page - 1) })}
          to="/admin/users"
        >
          Previous
        </Link>
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Link
          className={
            page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          search={(prev) => ({
            ...prev,
            page: Math.min(totalPages, page + 1),
          })}
          to="/admin/users"
        >
          Next
        </Link>
      </div>
    </div>
  );
}

import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdminTable } from "#/components/admin-table";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { getSession } from "#/lib/auth-guards";
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
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/admin" });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    return await listUsers({
      data: {
        q: deps.q,
        role: deps.role,
        includeBanned: deps.includeBanned,
        page: deps.page,
        pageSize: 20,
      },
    });
  },
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
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: users</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="user-search">Search</Label>
          <Input
            id="user-search"
            type="search"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Email or name"
            className="mt-1 w-48"
          />
        </div>
        <div>
          <Label htmlFor="user-role">Role</Label>
          <select
            id="user-role"
            value={role ?? ""}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  role: (e.target.value || null) as
                    | (typeof ROLES)[number]
                    | null,
                  page: 1,
                }),
              })
            }
            className="mt-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={includeBanned}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  includeBanned: e.target.checked,
                  page: 1,
                }),
              })
            }
          />
          Include banned
        </label>
      </div>

      <AdminTable columns={["Email", "Name", "Role", "Banned", ""]}>
        {rows.map((u) => (
          <tr key={u.id}>
            <td className="border border-border p-2">{u.email}</td>
            <td className="border border-border p-2">{u.name ?? "(none)"}</td>
            <td className="border border-border p-2">{u.role}</td>
            <td className="border border-border p-2">
              {u.banned ? "yes" : ""}
            </td>
            <td className="border border-border p-2">
              <Link to="/admin/users/$userId" params={{ userId: u.id }}>
                Manage
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          to="/admin/users"
          search={(prev) => ({ ...prev, page: Math.max(1, page - 1) })}
          className={
            page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Previous
        </Link>
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Link
          to="/admin/users"
          search={(prev) => ({
            ...prev,
            page: Math.min(totalPages, page + 1),
          })}
          className={
            page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Next
        </Link>
      </div>
    </div>
  );
}

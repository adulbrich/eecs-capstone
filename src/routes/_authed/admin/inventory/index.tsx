import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdminTable } from "#/components/admin-table";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { listInventory } from "#/server/inventory";

const STATUSES = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
] as const;

type Status = (typeof STATUSES)[number];

const searchSchema = z.object({
  q: z.string().default(""),
  status: z.enum(STATUSES).nullable().default(null),
  page: z.number().int().min(1).default(1),
});

export const Route = createFileRoute("/_authed/admin/inventory/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Inventory") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    await listInventory({
      data: {
        q: deps.q,
        status: deps.status,
        category: null,
        page: deps.page,
        pageSize: 20,
      },
    }),
  component: AdminInventory,
});

interface StaffRow {
  category: string | null;
  currentHolderId?: string | null;
  currentHolderLabel?: string | null;
  id: string;
  imageUrl: string | null;
  location: string | null;
  name: string;
  status: string;
}

function AdminInventory() {
  const navigate = useNavigate({ from: "/admin/inventory/" });
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const { q, status } = Route.useSearch();
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
            <BreadcrumbPage>Inventory</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">Inventory</h1>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/inventory/requests">Request queue</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/admin/inventory/new">+ New item</Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="inv-search">Search</Label>
          <Input
            className="mt-1 w-48"
            id="inv-search"
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Name or description"
            type="search"
            value={qDraft}
          />
        </div>
        <div>
          <Label htmlFor="inv-status">Status</Label>
          <Select
            onValueChange={(v) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  status: (v === "_all_" ? null : v) as Status | null,
                  page: 1,
                }),
              })
            }
            value={status ?? "_all_"}
          >
            <SelectTrigger className="mt-1 w-40" id="inv-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <AdminTable
        columns={["Name", "Status", "Holder", "Location", "Category", ""]}
      >
        {rows.map((r) => {
          const row = r as unknown as StaffRow;
          const img = getPublicUrl(row.imageUrl);
          const holder = row.currentHolderId ?? row.currentHolderLabel ?? "";
          return (
            <tr key={row.id}>
              <td className="border border-border p-2" data-label="Name">
                <div className="flex items-center gap-2">
                  {img ? (
                    <img
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                      src={img}
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-secondary" />
                  )}
                  <Link
                    className="hover:underline"
                    params={{ itemId: row.id }}
                    to="/admin/inventory/$itemId"
                  >
                    {row.name}
                  </Link>
                </div>
              </td>
              <td className="border border-border p-2" data-label="Status">
                <InventoryStatusBadge
                  showRetired
                  status={row.status as Status}
                />
              </td>
              <td className="border border-border p-2" data-label="Holder">
                {holder || "-"}
              </td>
              <td className="border border-border p-2" data-label="Location">
                {row.location ?? "-"}
              </td>
              <td className="border border-border p-2" data-label="Category">
                {row.category ?? "-"}
              </td>
              <td className="border border-border p-2">
                <Link
                  className="hover:underline"
                  params={{ itemId: row.id }}
                  to="/admin/inventory/$itemId/edit"
                >
                  Edit
                </Link>
              </td>
            </tr>
          );
        })}
      </AdminTable>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          className={
            page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          search={{ q, status, page: Math.max(1, page - 1) }}
          to="/admin/inventory"
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
          search={{ q, status, page: Math.min(totalPages, page + 1) }}
          to="/admin/inventory"
        >
          Next
        </Link>
      </div>
    </div>
  );
}

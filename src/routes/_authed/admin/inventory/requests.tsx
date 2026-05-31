import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AdminRequestQueueRow } from "#/components/admin-request-queue-row";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { listInventoryRequests } from "#/server/inventory";

const searchSchema = z.object({
  tab: z.enum(["pending", "all"]).default("pending"),
});

export const Route = createFileRoute("/_authed/admin/inventory/requests")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Inventory Requests") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ deps }) =>
    await listInventoryRequests({ data: { tab: deps.tab } }),
  component: AdminRequestQueue,
});

function AdminRequestQueue() {
  const batches = Route.useLoaderData();
  const { tab } = Route.useSearch();

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
            <BreadcrumbLink asChild>
              <Link to="/admin/inventory">Inventory</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Requests</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Inventory requests</h1>

      <div className="mt-4 flex gap-4 border-border border-b">
        {(["pending", "all"] as const).map((t) => (
          <Link
            className={
              t === tab
                ? "border-b-2 px-2 py-1 font-medium"
                : "px-2 py-1 text-muted-foreground hover:text-foreground"
            }
            key={t}
            search={{ tab: t }}
            style={
              t === tab
                ? { borderBottomColor: "var(--brand-primary)" }
                : undefined
            }
            to="/admin/inventory/requests"
          >
            {t === "pending" ? "Pending" : "All"}
          </Link>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {batches.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No requests in this view.
          </p>
        )}
        {batches.map((batch) => (
          <section
            className="rounded-md border border-border bg-card p-4"
            key={batch.requestId}
          >
            <header className="mb-3">
              <p className="font-medium">
                {batch.requester.name ?? batch.requester.email}
              </p>
              <p className="text-muted-foreground text-xs">
                {batch.requester.email} {" · "}
                {new Date(batch.createdAt).toLocaleString()}
              </p>
              {batch.note && (
                <p className="mt-2 whitespace-pre-wrap text-sm">{batch.note}</p>
              )}
            </header>
            <div className="space-y-2">
              {batch.lines.map((row) => (
                <AdminRequestQueueRow
                  item={{
                    id: row.item.id,
                    name: row.item.name,
                    status: row.item.status,
                  }}
                  key={row.line.id}
                  line={{ id: row.line.id, status: row.line.status }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

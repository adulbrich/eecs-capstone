import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";
import { FilterSwitch } from "#/components/filter-switch";
import { ProjectRow } from "#/components/project-row";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { listAdminProjects } from "#/server/projects-queries";

const STATUSES = [
  "all",
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
});

export const Route = createFileRoute("/_authed/admin/projects/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({
    status: search.status,
    includeSoftDeleted: search.includeSoftDeleted,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        status: deps.status,
        includeSoftDeleted: deps.includeSoftDeleted,
      },
    }),
  component: AdminProjects,
});

function AdminProjects() {
  const { rows } = Route.useLoaderData();
  const { status, includeSoftDeleted } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/projects/" });

  const label = (s: string) => s.replace(/_/g, " ");

  const softDeleteToggle = (
    <FilterSwitch
      checked={includeSoftDeleted}
      id="admin-include-soft-deleted"
      label="Show soft-deleted"
      onCheckedChange={(checked) =>
        void navigate({
          to: "/admin/projects",
          search: (prev) => ({ ...prev, includeSoftDeleted: checked }),
        })
      }
    />
  );

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
            <BreadcrumbPage>Projects</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Projects</h1>

      {/* Mobile: Select + soft-deleted toggle */}
      <div className="mt-4 space-y-2 md:hidden">
        <Select
          onValueChange={(s) =>
            void navigate({
              to: "/admin/projects",
              search: (prev) => ({
                ...prev,
                status: s as (typeof STATUSES)[number],
              }),
            })
          }
          value={status}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {softDeleteToggle}
      </div>

      {/* Desktop: tab strip + soft-deleted toggle */}
      <div className="mt-4 hidden items-end justify-between md:flex">
        <div className="flex border-border border-b text-sm">
          {STATUSES.map((s) => (
            <Link
              className={
                s === status
                  ? "-mb-px border-b-2 px-3 py-1.5 font-medium"
                  : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
              key={s}
              search={(prev) => ({ ...prev, status: s })}
              style={
                s === status
                  ? { borderBottomColor: "var(--brand-primary)" }
                  : undefined
              }
              to="/admin/projects"
            >
              {label(s)}
            </Link>
          ))}
        </div>
        <div>{softDeleteToggle}</div>
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No projects in this view.
          </p>
        ) : (
          rows.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}

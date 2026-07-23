import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
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
import { listPrograms } from "#/server/programs";
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
  includeSoftDeleted: z.boolean().default(false),
  program: z.string().uuid().nullable().default(null),
  status: z.enum(STATUSES).default("all"),
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
    includeSoftDeleted: search.includeSoftDeleted,
    program: search.program,
    status: search.status,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        includeSoftDeleted: deps.includeSoftDeleted,
        program: deps.program,
        status: deps.status,
      },
    }),
  component: AdminProjects,
});

function AdminProjects() {
  const { rows } = Route.useLoaderData();
  const { includeSoftDeleted, program, status } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/projects/" });
  const [allPrograms, setAllPrograms] = useState<
    { courseId: string; courseName: string; id: string }[]
  >([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows: progs } = await listPrograms();
        setAllPrograms(progs);
      } catch {
        // Filter degrades to "All programs" if the list cannot be loaded.
      }
    })();
  }, []);

  const label = (s: string) => s.replace(/_/g, " ");

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

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div>
          <Label htmlFor="admin-filter-status">Status</Label>
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
            <SelectTrigger
              className="mt-1 w-full md:w-48"
              id="admin-filter-status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : label(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="admin-filter-program">Program</Label>
          <Select
            onValueChange={(v) =>
              void navigate({
                to: "/admin/projects",
                search: (prev) => ({
                  ...prev,
                  program: v === "_all_" ? null : v,
                }),
              })
            }
            value={program ?? "_all_"}
          >
            <SelectTrigger
              className="mt-1 w-full md:w-56"
              id="admin-filter-program"
            >
              <SelectValue placeholder="All programs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All programs</SelectItem>
              {allPrograms.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.courseId} {p.courseName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
      </div>
      {rows.length === 0 ? (
        <EmptyState>No projects in this view.</EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {rows.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

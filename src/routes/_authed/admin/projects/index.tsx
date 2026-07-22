import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

  const programFilter = (idSuffix: string) => {
    const triggerId = `admin-filter-program-${idSuffix}`;
    return (
      <div>
        <Label className="sr-only" htmlFor={triggerId}>
          Program
        </Label>
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
          <SelectTrigger className="w-56" id={triggerId}>
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
    );
  };

  const softDeleteToggle = (idSuffix: string) => (
    <FilterSwitch
      checked={includeSoftDeleted}
      id={`admin-include-soft-deleted-${idSuffix}`}
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
        {programFilter("mobile")}
        {softDeleteToggle("mobile")}
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
        <div className="flex items-end gap-3">
          {programFilter("desktop")}
          {softDeleteToggle("desktop")}
        </div>
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

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
  // Better Auth user ids are text, not UUIDs.
  proposer: z.string().max(255).nullable().default(null),
  q: z.string().max(200).default(""),
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
    proposer: search.proposer,
    q: search.q,
    status: search.status,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        includeSoftDeleted: deps.includeSoftDeleted,
        program: deps.program,
        proposer: deps.proposer,
        q: deps.q,
        status: deps.status,
      },
    }),
  component: AdminProjects,
});

function AdminProjects() {
  const { rows, proposers } = Route.useLoaderData();
  const { includeSoftDeleted, program, proposer, q, status } =
    Route.useSearch();
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

  // Debounced URL sync, matching the public listing's filter bar: the input is
  // local so typing stays responsive, and the URL (and therefore the loader)
  // catches up once the user pauses.
  const [queryDraft, setQueryDraft] = useState(q);
  useEffect(() => setQueryDraft(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (queryDraft !== q) {
        void navigate({
          to: "/admin/projects",
          search: (prev) => ({ ...prev, q: queryDraft }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [queryDraft, q, navigate]);

  // The chosen proposer can fall outside the current status/program/deleted
  // scope, which would leave the Select showing a blank trigger. Keep the row
  // count honest by surfacing it as a still-selected option.
  const proposerMissing =
    !!proposer && !proposers.some((p) => p.id === proposer);

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

      <div className="mt-4">
        <Label htmlFor="admin-search">Search</Label>
        <Input
          className="mt-1"
          id="admin-search"
          onChange={(e) => setQueryDraft(e.target.value)}
          placeholder="Search titles and descriptions"
          type="search"
          value={queryDraft}
        />
      </div>

      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
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
        <div>
          <Label htmlFor="admin-filter-proposer">Proposer</Label>
          <Select
            onValueChange={(v) =>
              void navigate({
                to: "/admin/projects",
                search: (prev) => ({
                  ...prev,
                  proposer: v === "_all_" ? null : v,
                }),
              })
            }
            value={proposer ?? "_all_"}
          >
            <SelectTrigger
              className="mt-1 w-full md:w-56"
              id="admin-filter-proposer"
            >
              <SelectValue placeholder="All proposers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All proposers</SelectItem>
              {proposers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.email})
                </SelectItem>
              ))}
              {proposerMissing && proposer && (
                <SelectItem value={proposer}>
                  Selected proposer (outside current filters)
                </SelectItem>
              )}
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

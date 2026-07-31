import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
} from "#/components/admin-data-table";
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
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import {
  type AdminTableSearch,
  type SortState,
  useAdminTableState,
} from "#/lib/table-state";
import { listMentors, setUserMentorStatus } from "#/server/users";

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  q: z.string().default(""),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/_authed/admin/mentors/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Mentors") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  // Only the filter field: sort and column visibility are client state and
  // must not re-run the loader.
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }) => await listMentors({ data: deps }),
  component: MentorsAdmin,
});

type Row = Awaited<ReturnType<typeof listMentors>>["rows"][number];

const MIN_TEAMS = 1;
const MAX_TEAMS = 5;

const DEFAULT_SORT: SortState = { desc: false, id: "name" };

function MentorControls({ mentor }: { mentor: Row }) {
  const router = useRouter();
  const [count, setCount] = useState(mentor.mentorTeamCount);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(wantsToMentor: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setUserMentorStatus({
        data: { userId: mentor.id, wantsToMentor, mentorTeamCount: count },
      });
      router.invalidate();
    } catch (err) {
      setError((err as Error).message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Teams for ${mentor.name ?? mentor.email}`}
        className="w-20"
        max={MAX_TEAMS}
        min={MIN_TEAMS}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n) || n < MIN_TEAMS) {
            setCount(MIN_TEAMS);
          } else if (n > MAX_TEAMS) {
            setCount(MAX_TEAMS);
          }
        }}
        onChange={(e) => setCount(Number(e.target.value))}
        type="number"
        value={count}
      />
      <div className="flex gap-2">
        <Button
          disabled={saving}
          onClick={() => save(true)}
          size="sm"
          variant="outline"
        >
          Save
        </Button>
        <Button
          disabled={saving}
          onClick={() => save(false)}
          size="sm"
          variant="outline"
        >
          Remove
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name ?? undefined,
    cell: ({ row }) => row.original.name ?? "(none)",
    enableHiding: false,
    header: "Name",
    id: "name",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.affiliation ?? undefined,
    cell: ({ row }) => row.original.affiliation ?? "(none)",
    header: "Affiliation",
    id: "affiliation",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.email,
    cell: ({ row }) => row.original.email,
    header: "Email",
    id: "email",
  },
  {
    cell: ({ row }) => <MentorControls mentor={row.original} />,
    enableHiding: false,
    enableSorting: false,
    header: "Capacity",
    id: "capacity",
  },
];

function MentorsAdmin() {
  const { rows } = Route.useLoaderData();
  const search = Route.useSearch();
  const { q } = search;
  const navigate = useNavigate({ from: "/admin/mentors/" });
  const [qDraft, setQDraft] = useState(q);

  useEffect(() => setQDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) {
        void navigate({ search: (prev) => ({ ...prev, q: qDraft }) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, q, navigate]);

  const setSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate]
  );
  const replaceSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        replace: true,
        search: (prev) => ({ ...prev, ...patch }),
      }),
    [navigate]
  );

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    replaceSearch,
    search,
    setSearch,
    storageKey: "mentors",
  });

  return (
    <div className="px-4 py-6 md:px-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Mentors</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Mentors</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Users who have volunteered to mentor a team. Adjust their team capacity
        or remove them.
      </p>

      <AdminDataTable
        caption="Mentors"
        columns={COLUMNS}
        data={rows}
        defaultSort={DEFAULT_SORT}
        emptyMessage="No mentors in this view."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onSortChange={onSortChange}
        sort={sort}
        storageKey="mentors"
        toolbar={
          <div>
            <Label htmlFor="mentor-search">Search</Label>
            <Input
              className="mt-1 w-64"
              id="mentor-search"
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Name, email, or affiliation"
              type="search"
              value={qDraft}
            />
          </div>
        }
      />
    </div>
  );
}

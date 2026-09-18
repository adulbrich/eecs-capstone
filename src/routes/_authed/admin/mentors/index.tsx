import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ExportCsvButton } from "#/components/export-csv-button";
import { SearchQueryNote, searchQueryNote } from "#/components/search-hint";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { ListCount } from "#/components/ui/pagination";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAction } from "#/lib/use-action";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { isStaff } from "#/lib/viewer";
import {
  exportMentors,
  listMentors,
  setUserMentorStatus,
} from "#/server/users";

/** The truncation note, and the `aria-describedby` that points at it. */
const MENTOR_SEARCH_NOTE_ID = "mentor-search-note";

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
    if (!isStaff(session.user)) {
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
  const {
    busy: saving,
    error,
    run,
  } = useAction({ fallback: "Could not save." });

  function save(wantsToMentor: boolean) {
    void run(async () => {
      await setUserMentorStatus({
        data: { userId: mentor.id, wantsToMentor, mentorTeamCount: count },
      });
      // Awaited inside the flight: the row this control sits in is loader
      // data, so re-enabling over the old copy shows the old capacity.
      await router.invalidate();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Capacity for ${mentor.name ?? mentor.email}`}
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
      {/*
        Default size, not sm: these sit directly beside the capacity input,
        which is h-9, so the row rule outranks Remove's usual sm
        (UI-CONVENTIONS, "Size follows the row, not the page").
      */}
      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => save(true)} type="button">
          Save
        </Button>
        <Button
          disabled={saving}
          onClick={() => save(false)}
          type="button"
          variant="ghost"
        >
          Remove
        </Button>
      </div>
      <FieldError message={error} />
    </div>
  );
}

type ExportRow = Awaited<ReturnType<typeof exportMentors>>["rows"][number];

// defineCsvColumns<ExportRow>() fails npm run typecheck if a field of
// ExportRow has no column here, so a future field added to exportMentorsAs's
// projection cannot silently miss the file.
const EXPORT_COLUMNS = defineCsvColumns<ExportRow>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Name", key: "name", value: (row) => row.name },
  { header: "Email", key: "email", value: (row) => row.email },
  {
    header: "Affiliation",
    key: "affiliation",
    value: (row) => row.affiliation,
  },
  { header: "Role", key: "role", value: (row) => row.role },
  {
    header: "Wants to mentor",
    key: "wantsToMentor",
    value: (row) => row.wantsToMentor,
  },
  {
    header: "Mentor team count",
    key: "mentorTeamCount",
    value: (row) => row.mentorTeamCount,
  },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
]);

const COLUMNS = defineAdminColumns<Row>()([
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
]);

function MentorsAdmin() {
  const { rows } = Route.useLoaderData();
  const search = Route.useSearch();
  const { q } = search;
  const filtered = q !== "";
  const navigate = useNavigate({ from: "/admin/mentors/" });

  const commitQuery = useCallback(
    (next: string) => {
      void navigate({ search: (prev) => ({ ...prev, q: next }) });
    },
    [navigate]
  );
  const [qDraft, setQDraft] = useDebouncedDraft(q, commitQuery);
  // The committed query, never `qDraft`: the note describes the search
  // that ran, and must not appear and vanish between keystrokes (#478).
  const queryNote = searchQueryNote(q);

  const { orderRows, tableProps } = useAdminTable({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
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
        actions={
          <ExportCsvButton
            filename="mentors"
            load={async () => {
              const { rows: exportRows } = await exportMentors({
                data: { q: search.q },
              });
              // The export's rows are a wider projection of the same
              // records the table lists under the same filter, keyed by the
              // same id, so ordering by the table's sorted id sequence
              // still applies even though this array did not come from
              // `rows`.
              return toCsv(
                EXPORT_COLUMNS,
                orderRows(exportRows, (row) => row.id)
              );
            }}
          />
        }
        caption="Mentors"
        data={rows}
        emptyMessage="No mentors yet."
        filtered={filtered}
        getRowId={(row) => row.id}
        noMatchMessage="No mentors in this view."
        {...tableProps}
        toolbar={
          <div className="w-64">
            <Label htmlFor="mentor-search">Search</Label>
            <Input
              aria-describedby={queryNote ? MENTOR_SEARCH_NOTE_ID : undefined}
              className="mt-1 w-full"
              id="mentor-search"
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Name, email, or affiliation"
              type="search"
              value={qDraft}
            />
            <SearchQueryNote id={MENTOR_SEARCH_NOTE_ID} query={q} />
          </div>
        }
      />
      <ListCount count={rows.length} />
    </div>
  );
}

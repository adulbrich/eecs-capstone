import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { CsvFormatHelp } from "#/components/placement/csv-format";
import { FilePickerButton } from "#/components/placement/file-picker-button";
import { ImportIssues } from "#/components/placement/import-issues";
import { NumberInput } from "#/components/placement/number-input";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { type ImportIssue, parseProjectsCsv } from "#/lib/placement/csv";
import { PROJECTS_FORMAT } from "#/lib/placement/formats";
import type { WorkspaceProject } from "#/lib/placement/types";
import {
  PARAMETER_LIMITS,
  projectsFromPortal,
  type Workspace,
} from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAction } from "#/lib/use-action";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";
import { exportAdminProjects } from "#/server/projects-queries";

export interface ProgramOption {
  id: string;
  label: string;
}

type Row = WorkspaceProject & { bidCount: number };

const DEFAULT_SORT: SortState = { desc: false, id: "title" };

export function ProjectsTab({
  programs,
  state,
  workspace,
}: {
  programs: ProgramOption[];
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const { bids, update } = state;
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [duplicates, setDuplicates] = useState<string[]>([]);

  const setProjects = (
    projects: WorkspaceProject[],
    projectSource: Workspace["projectSource"]
  ) =>
    // Pins and a result name project keys, so neither survives new projects.
    update((w) => ({
      ...w,
      projects,
      projectSource,
      pins: undefined,
      result: undefined,
    }));

  const bidCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const student of bids?.students ?? []) {
      for (const bid of student.bids) {
        counts.set(bid.projectKey, (counts.get(bid.projectKey) ?? 0) + 1);
      }
    }
    return counts;
  }, [bids]);

  const rows: Row[] = workspace.projects.map((p) => ({
    ...p,
    bidCount: bidCounts.get(p.key) ?? 0,
  }));

  if (workspace.projects.length === 0) {
    return (
      <ProjectsImport
        duplicates={duplicates}
        issues={issues}
        onPortal={(projects, projectSource, dupes) => {
          setIssues([]);
          setDuplicates(dupes);
          setProjects(projects, projectSource);
        }}
        onText={(text, filename) => {
          const parsed = parseProjectsCsv(text);
          setDuplicates([]);
          setIssues(parsed.issues);
          if (parsed.projects.length > 0) {
            setProjects(parsed.projects, { kind: "csv", filename });
          }
        }}
        programs={programs}
      />
    );
  }

  const source = workspace.projectSource;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {workspace.projects.length} projects from{" "}
          {source?.kind === "portal"
            ? `the published projects in ${source.programLabel}`
            : (source?.filename ?? "a file")}
          .
        </p>
        <ConfirmDialog
          busyLabel="Removing..."
          confirmLabel="Remove"
          description="The projects and their settings leave this workspace, and with them any placement and the pins set on it. The bids stay, and are matched again by title when new projects load."
          onConfirm={() => {
            setIssues([]);
            setDuplicates([]);
            setProjects([], null);
          }}
          title={`Remove the ${workspace.projects.length} projects?`}
        >
          <Button size="sm" type="button" variant="ghost">
            <Trash2 aria-hidden="true" />
            Remove projects
          </Button>
        </ConfirmDialog>
      </div>
      <DuplicateTitles titles={duplicates} />
      <ImportIssues issues={issues} label="projects" />
      <BoundsProblems
        parameters={workspace.parameters}
        projects={workspace.projects}
      />
      <ProjectsTable
        parameters={workspace.parameters}
        rows={rows}
        update={update}
      />
    </div>
  );
}

function ProjectsImport({
  duplicates,
  issues,
  onPortal,
  onText,
  programs,
}: {
  duplicates: string[];
  issues: ImportIssue[];
  onPortal: (
    projects: WorkspaceProject[],
    source: Workspace["projectSource"],
    duplicates: string[]
  ) => void;
  onText: (text: string, filename: string) => void;
  programs: ProgramOption[];
}) {
  const [programId, setProgramId] = useState("");
  const { busy, error, run } = useAction({
    fallback: "Could not load the program's projects",
  });
  const program = programs.find((p) => p.id === programId);
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="placement-portal-heading">
        <h2 className="font-medium" id="placement-portal-heading">
          From a program
        </h2>
        <p className="text-muted-foreground text-sm">
          The program's published projects, with max teams set from each
          project's teams supported.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="placement-program">Program</Label>
            <Select onValueChange={setProgramId} value={programId}>
              <SelectTrigger className="w-64" id="placement-program">
                <SelectValue placeholder="Choose a program" />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={busy || program === undefined}
            onClick={() =>
              void run(async () => {
                if (program === undefined) {
                  return;
                }
                const { rows } = await exportAdminProjects({
                  data: { statuses: ["published"], program: program.id },
                });
                const loaded = projectsFromPortal(rows);
                if (loaded.projects.length === 0) {
                  throw new Error(
                    `${program.label} has no published projects.`
                  );
                }
                onPortal(
                  loaded.projects,
                  {
                    kind: "portal",
                    programId: program.id,
                    programLabel: program.label,
                  },
                  loaded.duplicates
                );
              })
            }
            size="sm"
            type="button"
          >
            {busy ? "Loading..." : "Load published projects"}
          </Button>
        </div>
        <FieldError message={error} />
      </section>
      <section aria-labelledby="placement-projects-csv-heading">
        <h2 className="font-medium" id="placement-projects-csv-heading">
          From a file
        </h2>
        <p className="text-muted-foreground text-sm">
          For projects that are not in the portal, or a hand-edited list.
        </p>
        <div className="mt-2 flex flex-col items-start gap-2">
          <FilePickerButton
            accept=".csv,text/csv"
            inputLabel="Projects CSV file"
            onText={onText}
          >
            Upload projects CSV
          </FilePickerButton>
          <CsvFormatHelp format={PROJECTS_FORMAT} label="projects" />
        </div>
        <DuplicateTitles titles={duplicates} />
        <ImportIssues issues={issues} label="projects" />
      </section>
    </div>
  );
}

function DuplicateTitles({ titles }: { titles: string[] }) {
  if (titles.length === 0) {
    return null;
  }
  return (
    <p className="mt-4 text-sm" role="status">
      More than one published project is titled {titles.join(", ")}. A bid
      naming that title goes to the first of them.
    </p>
  );
}

/** A project whose own minimum is above its maximum can never form a team. */
function BoundsProblems({
  parameters,
  projects,
}: {
  parameters: Workspace["parameters"];
  projects: WorkspaceProject[];
}) {
  const problems = projects.filter(
    (p) =>
      (p.minStudents ?? parameters.minStudents) >
      (p.maxStudents ?? parameters.maxStudents)
  );
  return (
    <FieldError
      message={
        problems.length === 0
          ? null
          : `Min students per team is above max students per team for ${problems.map((p) => p.title).join(", ")}, so no team can form there.`
      }
    />
  );
}

function ProjectsTable({
  parameters,
  rows,
  update,
}: {
  parameters: Workspace["parameters"];
  rows: Row[];
  update: PlacementWorkspace["update"];
}) {
  const { navigate, search } = useLocalTableSearch();
  const columns = useMemo(() => {
    const setField =
      (key: string, field: "maxTeams" | "minStudents" | "maxStudents") =>
      (value: number | undefined) =>
        update((w) => ({
          ...w,
          projects: w.projects.map((p) =>
            p.key === key ? { ...p, [field]: value } : p
          ),
        }));
    const setWeight = (key: string) => (value: number | undefined) =>
      update((w) => ({
        ...w,
        projects: w.projects.map((p) =>
          p.key === key ? { ...p, weightMultiplier: value ?? 1 } : p
        ),
      }));
    const count = (
      field: "maxTeams" | "minStudents" | "maxStudents",
      header: string,
      fallback: number,
      limits: { min: number; max: number }
    ) => ({
      accessorFn: (row: Row) => row[field] ?? fallback,
      cell: ({ row }: { row: { original: Row } }) => (
        <NumberInput
          label={`${header}, ${row.original.title}`}
          max={limits.max}
          min={limits.min}
          onCommit={setField(row.original.key, field)}
          optional
          placeholder={String(fallback)}
          value={row.original[field]}
        />
      ),
      header,
      id: field,
      sortFn: "basic" as const,
    });
    return defineAdminColumns<Row>()([
      {
        accessorFn: (row) => row.title,
        cardHeader: true,
        cell: ({ row }) => row.original.title,
        enableHiding: false,
        header: "Project",
        id: "title",
      },
      {
        accessorFn: (row) => row.bidCount,
        cell: ({ row }) => row.original.bidCount,
        header: "Bids",
        id: "bidCount",
        sortFn: "basic",
      },
      count(
        "maxTeams",
        "Max teams",
        parameters.maxTeams,
        PARAMETER_LIMITS.maxTeams
      ),
      count(
        "minStudents",
        "Min students per team",
        parameters.minStudents,
        PARAMETER_LIMITS.students
      ),
      count(
        "maxStudents",
        "Max students per team",
        parameters.maxStudents,
        PARAMETER_LIMITS.students
      ),
      {
        accessorFn: (row) => row.weightMultiplier,
        cell: ({ row }) => (
          <NumberInput
            integer={false}
            label={`Weight, ${row.original.title}`}
            max={PARAMETER_LIMITS.multiplier.max}
            min={PARAMETER_LIMITS.multiplier.min}
            onCommit={setWeight(row.original.key)}
            value={row.original.weightMultiplier}
          />
        ),
        header: "Weight",
        id: "weightMultiplier",
        sortFn: "basic",
      },
    ]);
  }, [parameters, update]);

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-projects",
  });

  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-sm">
        A blank cell uses the default from the Parameters tab. Max teams is how
        many teams the project may form, and 0 leaves it out; min and max
        students apply to each of those teams. Weight multiplies every bid on
        the project: 1 leaves it alone, 0.25 steers students away.
      </p>
      <AdminDataTable
        caption="Projects in this placement"
        data={rows}
        emptyMessage="No projects."
        getRowId={(row) => row.key}
        {...tableProps}
      />
    </div>
  );
}

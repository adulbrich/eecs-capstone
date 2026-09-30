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
import { PasteList } from "#/components/placement/paste-list";
import { RosterProjects } from "#/components/placement/roster-projects";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { ProjectBadges } from "#/components/project-badges";
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
import {
  type ImportIssue,
  parseProjectsCsv,
  parseProjectTitles,
} from "#/lib/placement/csv";
import { PROJECTS_FORMAT } from "#/lib/placement/formats";
import type { WorkspaceProject } from "#/lib/placement/types";
import {
  contactFor,
  PARAMETER_LIMITS,
  projectsFromPortal,
  pruneTitleMatches,
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
  // Kept apart from the file's issues: a pasted list numbers lines, not rows.
  const [pasteIssues, setPasteIssues] = useState<ImportIssue[]>([]);
  const [duplicates, setDuplicates] = useState<string[]>([]);

  const setProjects = (
    projects: WorkspaceProject[],
    projectSource: Workspace["projectSource"]
  ) =>
    // Pins and a result name project keys, so neither survives new projects.
    // A title match does when its project is still there. Removing the
    // projects keeps them all, so reloading the same list loses none.
    update((w) => ({
      ...w,
      projects,
      projectSource,
      pins: undefined,
      result: undefined,
      titleMatches:
        projects.length === 0
          ? w.titleMatches
          : pruneTitleMatches(w.titleMatches, projects),
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
        onPaste={(text) => {
          const parsed = parseProjectTitles(text);
          setDuplicates([]);
          setIssues([]);
          setPasteIssues(parsed.issues);
          if (parsed.projects.length > 0) {
            setProjects(parsed.projects, { kind: "pasted" });
          }
        }}
        onPortal={(projects, projectSource, dupes) => {
          setIssues([]);
          setPasteIssues([]);
          setDuplicates(dupes);
          setProjects(projects, projectSource);
        }}
        onText={(text, filename) => {
          const parsed = parseProjectsCsv(text);
          setDuplicates([]);
          setIssues(parsed.issues);
          setPasteIssues([]);
          if (parsed.projects.length > 0) {
            setProjects(parsed.projects, { kind: "csv", filename });
          }
        }}
        pasteIssues={pasteIssues}
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
            : projectSourceLabel(source)}
          .
        </p>
        <ConfirmDialog
          busyLabel="Removing..."
          confirmLabel="Remove"
          description="The projects and their settings leave this workspace, and with them any placement and the pins set on it. The bids stay, and are matched again by title when new projects load."
          onConfirm={() => {
            setIssues([]);
            setPasteIssues([]);
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
      <ImportIssues issues={pasteIssues} label="project titles" unit="line" />
      <BoundsProblems
        parameters={workspace.parameters}
        projects={workspace.projects}
      />
      <ProjectsTable
        parameters={workspace.parameters}
        rows={rows}
        source={source}
        update={update}
      />
      <RosterProjects state={state} />
    </div>
  );
}

function ProjectsImport({
  duplicates,
  issues,
  onPaste,
  onPortal,
  onText,
  pasteIssues,
  programs,
}: {
  duplicates: string[];
  issues: ImportIssue[];
  onPaste: (text: string) => void;
  onPortal: (
    projects: WorkspaceProject[],
    source: Workspace["projectSource"],
    duplicates: string[]
  ) => void;
  onText: (text: string, filename: string) => void;
  pasteIssues: ImportIssue[];
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
      <section aria-labelledby="placement-projects-paste-heading">
        <h2 className="font-medium" id="placement-projects-paste-heading">
          From a list
        </h2>
        <p className="text-muted-foreground text-sm">
          A column of titles copied from a spreadsheet or an email. Each project
          takes the defaults on the Parameters tab.
        </p>
        <div className="mt-2">
          <PasteList
            buttonLabel="Use these titles"
            hint="One title per line. Blank lines are skipped."
            label="Project titles"
            onUse={onPaste}
            placeholder={"Tide Clock\nRobot Arm Controller"}
          />
        </div>
        <ImportIssues issues={pasteIssues} label="project titles" unit="line" />
      </section>
    </div>
  );
}

function projectSourceLabel(source: Workspace["projectSource"]): string {
  if (source?.kind === "csv") {
    return source.filename;
  }
  return source?.kind === "pasted" ? "a pasted list" : "a file";
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
  source,
  update,
}: {
  parameters: Workspace["parameters"];
  rows: Row[];
  source: Workspace["projectSource"];
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
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.original.title}
            <ProjectBadges
              requiresNdaIp={false}
              studentProposed={row.original.studentProposed === true}
            />
          </div>
        ),
        enableHiding: false,
        header: "Project",
        id: "title",
      },
      {
        accessorFn: (row) => {
          const contact = contactFor(row);
          return contact?.name ?? contact?.email;
        },
        cell: ({ row }) => <Contact project={row.original} />,
        defaultHidden: true,
        header: "Contact",
        headerHint:
          "The mentor for a student-proposed project, the proposer for any other.",
        id: "contact",
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
  const noContacts =
    !tableProps.hidden.includes("contact") &&
    rows.every((row) => contactFor(row) === null);

  return (
    <div className="mt-4">
      <p className="text-muted-foreground text-sm">
        A blank cell uses the default from the Parameters tab. Max teams is how
        many teams the project may form, and 0 leaves it out; min and max
        students apply to each of those teams. Weight multiplies every bid on
        the project: 1 leaves it alone, 0.25 steers students away.
      </p>
      {noContacts && (
        <p className="mt-2 text-sm" role="status">
          {source?.kind === "portal"
            ? "No project here names a contact. Projects loaded before placement kept contacts have none: load the program again to fill them, which replaces the list and clears any placement and pins."
            : "No project here names a contact. A projects CSV can carry proposer_name, proposer_email, mentor_name, mentor_email and student_proposed columns."}
        </p>
      )}
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

/** The contact's name over their email, and which of the two they are. */
function Contact({ project }: { project: WorkspaceProject }) {
  const contact = contactFor(project);
  if (contact === null) {
    return "-";
  }
  return (
    <div className="min-w-0">
      <div className="wrap-anywhere">{contact.name ?? contact.email}</div>
      <div className="wrap-anywhere text-muted-foreground text-xs">
        {contact.name && contact.email ? `${contact.email}, ` : ""}
        {contact.role}
      </div>
    </div>
  );
}

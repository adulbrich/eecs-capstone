import { ChartColumn, Download, X } from "lucide-react";
import { useMemo } from "react";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { type CsvColumn, toCsv } from "#/lib/csv";
import {
  bidsPerProject,
  type PriorityRow,
  type ProjectBids,
  priorityDistribution,
} from "#/lib/placement/analytics";
import {
  applyPins,
  type BoardRow,
  boardRows,
  projectsWithoutTeam,
  unplacedReason,
} from "#/lib/placement/board";
import { downloadText } from "#/lib/placement/download";
import type { WorkspaceProject } from "#/lib/placement/types";
import type { Workspace } from "#/lib/placement/workspace";

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

const BIDS_COLUMNS: CsvColumn<ProjectBids>[] = [
  { header: "project", value: (r) => r.title },
  { header: "first_choice_bids", value: (r) => r.firstChoice },
  { header: "total_bids", value: (r) => r.total },
];
const PRIORITY_COLUMNS: CsvColumn<PriorityRow>[] = [
  { header: "priority", value: (r) => r.label },
  { header: "students", value: (r) => r.count },
  { header: "percent_of_placed", value: (r) => percent(r.ofPlaced) },
  { header: "percent_of_all", value: (r) => percent(r.ofAll) },
];
const UNPLACED_COLUMNS: CsvColumn<BoardRow>[] = [
  { header: "email", value: (r) => r.email },
  { header: "name", value: (r) => r.name },
  { header: "reason", value: (r) => unplacedReason(r.unplacedReason) },
];
const NO_TEAM_COLUMNS: CsvColumn<WorkspaceProject>[] = [
  { header: "project", value: (r) => r.title },
];

/**
 * The analytics over a placement workspace (#650), in a Sheet so the page
 * behind it stays where the reader left it. Bids per project is there as
 * soon as bids are; the other three wait for a run.
 */
export function AnalyticsSheet({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const bids = state.bids?.students ?? [];
  const { projects, pins, result } = workspace;
  const perProject = useMemo(
    () => bidsPerProject(bids, projects),
    [bids, projects]
  );
  const rows = useMemo(
    () => (result ? boardRows(result, applyPins(bids, pins), projects) : null),
    [result, bids, pins, projects]
  );
  const unplaced = rows?.filter((r) => r.projectKey === null) ?? [];
  const noTeam = result
    ? projectsWithoutTeam(result, projects, workspace.parameters.maxTeams)
    : [];
  const priorities = rows ? priorityDistribution(rows) : [];

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <ChartColumn aria-hidden="true" />
          Analytics
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="flex-row items-start justify-between gap-2">
          <div>
            <SheetTitle>Placement analytics</SheetTitle>
            <SheetDescription>
              Worked out in this browser from the bids and the last run.
            </SheetDescription>
          </div>
          {/*
            Explicit, because this SheetContent draws no close control of
            its own, and at phone width the sheet covers the overlay a tap
            would otherwise close it with.
          */}
          <SheetClose asChild>
            <Button size="sm" type="button" variant="ghost">
              <X aria-hidden="true" />
              Close
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="flex flex-col gap-8 px-4 pb-8">
          <Section
            csv={() => toCsv(BIDS_COLUMNS, perProject)}
            empty={
              projects.length === 0
                ? "Load the projects on the Projects tab to fill this in."
                : null
            }
            filename="bids-per-project"
            title="Bids per project"
          >
            <p className="text-muted-foreground text-sm">
              Fewest bids first, so a project nobody picked is at the top.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">First choice</TableHead>
                  <TableHead className="text-right">All bids</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perProject.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="whitespace-normal">
                      {p.title}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.firstChoice}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.total}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            csv={() => toCsv(PRIORITY_COLUMNS, priorities)}
            empty={rows === null ? NO_RUN : null}
            filename="priority-distribution"
            title="Priority distribution"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Placed on</TableHead>
                  <TableHead className="text-right">Students</TableHead>
                  <TableHead className="text-right">Of placed</TableHead>
                  <TableHead className="text-right">Of all</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priorities.map((p) => (
                  <TableRow key={p.label}>
                    <TableCell>{p.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(p.ofPlaced)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(p.ofAll)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            csv={() => toCsv(UNPLACED_COLUMNS, unplaced)}
            empty={afterRun(
              rows !== null,
              unplaced.length,
              "Every student is placed."
            )}
            filename="unplaced-students"
            title="Unplaced students"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unplaced.map((r) => (
                  <TableRow key={r.email}>
                    <TableCell className="whitespace-normal">
                      {r.name || r.email}
                      {r.name && (
                        <div className="text-muted-foreground text-xs">
                          {r.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {unplacedReason(r.unplacedReason)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            csv={() => toCsv(NO_TEAM_COLUMNS, noTeam)}
            empty={afterRun(
              result !== undefined,
              noTeam.length,
              "Every project allowed a team formed one."
            )}
            filename="projects-with-no-team"
            title="Projects with no team formed"
          >
            <ul className="list-disc pl-5 text-sm">
              {noTeam.map((p) => (
                <li key={p.key}>{p.title}</li>
              ))}
            </ul>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const NO_RUN = "Run placement on the Results tab to fill this in.";

/** What a table that needs a run says instead of rendering, if anything. */
function afterRun(ran: boolean, count: number, none: string): string | null {
  if (!ran) {
    return NO_RUN;
  }
  return count === 0 ? none : null;
}

function Section({
  children,
  csv,
  empty,
  filename,
  title,
}: {
  children: React.ReactNode;
  csv: () => string;
  /** Shown instead of the table, and the download hidden, when set. */
  empty: string | null;
  filename: string;
  title: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        {empty === null && (
          <Button
            aria-label={`Download ${title.toLowerCase()} as CSV`}
            onClick={() =>
              downloadText(
                `${filename}-${new Date().toISOString().slice(0, 10)}.csv`,
                csv(),
                "text/csv"
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" />
            Download CSV
          </Button>
        )}
      </div>
      {empty === null ? (
        children
      ) : (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
    </section>
  );
}

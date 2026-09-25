import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { z } from "zod";
import { BidsTab } from "#/components/placement/bids-tab";
import { ParametersTab } from "#/components/placement/parameters-tab";
import { ProjectsTab } from "#/components/placement/projects-tab";
import { usePlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { WorkspaceActions } from "#/components/placement/workspace-actions";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { FieldError } from "#/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { pageTitle } from "#/lib/page-title";
import { isStaff } from "#/lib/viewer";
import { listPrograms } from "#/server/programs";

const TABS = ["projects", "bids", "parameters"] as const;
type Tab = (typeof TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TABS).default("projects"),
});

export const Route = createFileRoute("/_authed/admin/placement")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Placement") }] }),
  beforeLoad: ({ context }) => {
    if (!isStaff(context.user)) {
      throw redirect({ to: "/" });
    }
  },
  // The program list is the page's only server read besides the published
  // projects a staff member asks for. Nothing about a student is sent
  // (ADR-0056).
  loader: async () => listPrograms(),
  component: PlacementPage,
});

function PlacementPage() {
  const { rows } = Route.useLoaderData();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/placement" });
  const state = usePlacementWorkspace();
  const { workspace, bids } = state;
  const programs = rows.map((p) => ({
    id: p.id,
    label: `${p.courseId} ${p.courseName}`,
  }));

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
            <BreadcrumbPage>Placement</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-semibold text-2xl">Placement</h1>
          <p className="mt-1 max-w-prose text-muted-foreground text-sm">
            Bids, placements and settings on this page stay in this browser and
            are never sent to the server. Export the workspace to move it to
            another browser.
          </p>
        </div>
        {workspace && <WorkspaceActions state={state} workspace={workspace} />}
      </div>
      <FieldError
        message={
          state.unreadable
            ? "The workspace saved in this browser could not be read, so the page started empty. The old copy is kept under its own key in this browser's storage; ask the development team to recover it."
            : null
        }
      />
      <FieldError
        message={
          state.saveFailed
            ? "This browser would not save the workspace, so it will be gone when the page closes. Export it to keep it."
            : null
        }
      />

      {workspace === null ? (
        <p className="mt-6 text-muted-foreground text-sm">Loading...</p>
      ) : (
        <Tabs
          activationMode="manual"
          className="mt-4"
          onValueChange={(next) => navigate({ search: { tab: next as Tab } })}
          value={tab}
        >
          <TabsList>
            <TabsTrigger value="projects">
              Projects ({workspace.projects.length})
            </TabsTrigger>
            <TabsTrigger value="bids">
              Bids ({bids?.students.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
          </TabsList>
          <TabsContent value="projects">
            <ProjectsTab
              programs={programs}
              state={state}
              workspace={workspace}
            />
          </TabsContent>
          <TabsContent value="bids">
            <BidsTab state={state} workspace={workspace} />
          </TabsContent>
          <TabsContent value="parameters">
            <ParametersTab state={state} workspace={workspace} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

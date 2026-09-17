import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { InstructorManager } from "#/components/instructor-manager";
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
import { Textarea } from "#/components/ui/textarea";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { useAction } from "#/lib/use-action";
import { isStaff } from "#/lib/viewer";
import { deleteProgram, getProgram, updateProgram } from "#/server/programs";

export const Route = createFileRoute("/_authed/admin/programs/$programId")({
  head: () => ({ meta: [{ title: pageTitle("Edit Program") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ params }) => getProgram({ data: { id: params.programId } }),
  component: ProgramEdit,
});

function ProgramEdit() {
  const navigate = useNavigate();
  const router = useRouter();
  const { program, instructors, projectCount } = Route.useLoaderData();
  const [courseId, setCourseId] = useState(program.courseId);
  const [courseName, setCourseName] = useState(program.courseName);
  const [description, setDescription] = useState(program.description ?? "");
  // A string because it is an input; "" is unset and saves as null.
  const [termCount, setTermCount] = useState(
    program.termCount === null ? "" : String(program.termCount)
  );
  const [expectedTeams, setExpectedTeams] = useState(
    program.expectedTeams === null ? "" : String(program.expectedTeams)
  );
  const { busy, error, run } = useAction({ fallback: "Save failed" });

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      await updateProgram({
        data: {
          id: program.id,
          courseId,
          courseName,
          description: description || null,
          termCount: termCount === "" ? null : Number(termCount),
          expectedTeams: expectedTeams === "" ? null : Number(expectedTeams),
        },
      });
      toast.success("Program saved.");
      navigate({ to: "/admin/programs" });
    });
  }

  // ConfirmDialog owns the flight and the refusal (#410).
  async function onDelete() {
    await deleteProgram({ data: { id: program.id } });
    navigate({ to: "/admin/programs" });
  }

  // A project runs in a set of programs (#462), so deleting this one does
  // not unlink anything: each of these projects loses this program and
  // keeps the rest, and only the ones with no other are left unplaced. The
  // old wording said "unlinked but kept", which is false for a shared
  // project. The count is `projectCount` from `getProgram`, not the
  // `affectedProjectCount` the delete returns; nothing renders that one.
  const deleteDescription =
    projectCount > 0
      ? `${projectCount} project(s) will lose this program and keep any others. A project with no other program is left unplaced.`
      : "This cannot be undone.";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/programs">Programs</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{program.courseId}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Edit program</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        {projectCount} linked project{projectCount === 1 ? "" : "s"}
      </p>

      <form className="mt-6 space-y-3" onSubmit={onSave}>
        <div className="space-y-1.5">
          <Label htmlFor="course-id">Course ID</Label>
          <Input
            id="course-id"
            onChange={(e) => setCourseId(e.target.value)}
            required
            value={courseId}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-name">Course name</Label>
          <Input
            id="course-name"
            onChange={(e) => setCourseName(e.target.value)}
            required
            value={courseName}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-desc">Description</Label>
          <Textarea
            id="course-desc"
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            value={description}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-terms">Terms</Label>
          <Input
            id="course-terms"
            inputMode="numeric"
            max={12}
            min={1}
            onChange={(e) => setTermCount(e.target.value)}
            type="number"
            value={termCount}
          />
          <p className="text-muted-foreground text-xs">
            How many academic terms the course runs. The scope assessment judges
            proposals against it; leave it blank if unsure, and the assessment
            says so rather than guessing.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-expected-teams">Expected teams</Label>
          <Input
            id="course-expected-teams"
            inputMode="numeric"
            min={0}
            onChange={(e) => setExpectedTeams(e.target.value)}
            type="number"
            value={expectedTeams}
          />
          <p className="text-muted-foreground text-xs">
            How many student teams the office expects to place this cycle. The
            analytics dashboard compares published team slots against it; leave
            it blank and the dashboard says "not set".
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
          <ConfirmDialog
            description={deleteDescription}
            onConfirm={onDelete}
            title={`Delete program "${program.courseName}"?`}
          >
            <Button type="button" variant="destructive">
              Delete
            </Button>
          </ConfirmDialog>
        </div>
        <FieldError message={error} />
      </form>

      <InstructorManager
        initial={instructors}
        onChanged={() => router.invalidate()}
        programId={program.id}
      />
    </div>
  );
}

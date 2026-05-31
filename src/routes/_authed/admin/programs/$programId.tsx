import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
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
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { deleteProgram, getProgram, updateProgram } from "#/server/programs";

export const Route = createFileRoute("/_authed/admin/programs/$programId")({
  head: () => ({ meta: [{ title: pageTitle("Edit Program") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
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
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateProgram({
        data: {
          id: program.id,
          courseId,
          courseName,
          description: description || null,
        },
      });
      navigate({ to: "/admin/programs" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete() {
    const msg =
      projectCount > 0
        ? `Delete program "${program.courseName}"? ${projectCount} project(s) will be unlinked but kept.`
        : `Delete program "${program.courseName}"?`;
    if (!confirm(msg)) {
      return;
    }
    setError(null);
    try {
      await deleteProgram({ data: { id: program.id } });
      navigate({ to: "/admin/programs" });
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
        <div className="flex gap-2">
          <Button size="sm" type="submit">
            Save
          </Button>
          <Button
            onClick={() => void onDelete()}
            size="sm"
            type="button"
            variant="destructive"
          >
            Delete
          </Button>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </form>

      <InstructorManager
        initial={instructors}
        onChanged={() => router.invalidate()}
        programId={program.id}
      />
    </div>
  );
}

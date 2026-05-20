import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { InstructorManager } from "#/components/instructor-manager";
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
    if (!session?.user) throw redirect({ to: "/sign-in" });
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
    if (!confirm(msg)) return;
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
      <h1 className="text-2xl font-semibold">Edit program</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {projectCount} linked project{projectCount === 1 ? "" : "s"}
      </p>

      <form onSubmit={onSave} className="mt-6 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="course-id">Course ID</Label>
          <Input
            id="course-id"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-name">Course name</Label>
          <Input
            id="course-name"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="course-desc">Description</Label>
          <Textarea
            id="course-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>

      <InstructorManager
        programId={program.id}
        initial={instructors}
        onChanged={() => router.invalidate()}
      />
    </div>
  );
}

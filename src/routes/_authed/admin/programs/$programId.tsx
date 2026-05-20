import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { InstructorManager } from "#/components/instructor-manager";
import { getSession } from "#/lib/auth-guards";
import { deleteProgram, getProgram, updateProgram } from "#/server/programs";

export const Route = createFileRoute("/_authed/admin/programs/$programId")({
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
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Edit program</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {projectCount} linked project{projectCount === 1 ? "" : "s"}
      </p>

      <form onSubmit={onSave} className="mt-6 space-y-3">
        <div>
          <label
            htmlFor="course-id"
            className="block text-xs font-medium text-neutral-500"
          >
            Course ID
          </label>
          <input
            id="course-id"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            required
            className="mt-1 w-full border p-2"
          />
        </div>
        <div>
          <label
            htmlFor="course-name"
            className="block text-xs font-medium text-neutral-500"
          >
            Course name
          </label>
          <input
            id="course-name"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            required
            className="mt-1 w-full border p-2"
          />
        </div>
        <div>
          <label
            htmlFor="course-desc"
            className="block text-xs font-medium text-neutral-500"
          >
            Description
          </label>
          <textarea
            id="course-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full border p-2"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="bg-brand px-3 py-2 text-sm text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void onDelete()}
            className="border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <InstructorManager
        programId={program.id}
        initial={instructors}
        onChanged={() => router.invalidate()}
      />
    </div>
  );
}

import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { getSession } from "#/lib/auth-guards";
import { createProgram, listPrograms } from "#/server/programs";

export const Route = createFileRoute("/_authed/admin/programs/")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => listPrograms(),
  component: ProgramsAdmin,
});

function ProgramsAdmin() {
  const router = useRouter();
  const { rows } = Route.useLoaderData();
  const [courseId, setCourseId] = useState("");
  const [courseName, setCourseName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProgram({
        data: { courseId, courseName, description: description || null },
      });
      setCourseId("");
      setCourseName("");
      setDescription("");
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: programs</h1>

      <form onSubmit={onCreate} className="mt-6 grid gap-2 md:grid-cols-3">
        <input
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          placeholder="Course ID (e.g., CS-462)"
          required
          className="border p-2"
        />
        <input
          value={courseName}
          onChange={(e) => setCourseName(e.target.value)}
          placeholder="Course name"
          required
          className="border p-2"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="border p-2"
        />
        <div className="md:col-span-3">
          <button
            type="submit"
            className="bg-black px-3 py-2 text-sm text-white"
          >
            Create program
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <AdminTable columns={["Course ID", "Course name", ""]}>
        {rows.map((p) => (
          <tr key={p.id}>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {p.courseId}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              {p.courseName}
            </td>
            <td className="border border-neutral-200 p-2 dark:border-neutral-800">
              <Link
                to="/admin/programs/$programId"
                params={{ programId: p.id }}
                className="text-blue-700 hover:underline"
              >
                Manage
              </Link>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}

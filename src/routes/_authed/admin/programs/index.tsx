import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { createProgram, listPrograms } from "#/server/programs";

export const Route = createFileRoute("/_authed/admin/programs/")({
  head: () => ({ meta: [{ title: pageTitle("Programs") }] }),
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
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Admin: programs</h1>

      <form onSubmit={onCreate} className="mt-6 grid gap-2 md:grid-cols-3">
        <Input
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          placeholder="Course ID (e.g., CS-462)"
          required
        />
        <Input
          value={courseName}
          onChange={(e) => setCourseName(e.target.value)}
          placeholder="Course name"
          required
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <div className="md:col-span-3">
          <Button type="submit" size="sm">
            Create program
          </Button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <AdminTable columns={["Course ID", "Course name", ""]}>
        {rows.map((p) => (
          <tr key={p.id}>
            <td data-label="Course ID" className="border border-border p-2">
              {p.courseId}
            </td>
            <td data-label="Course name" className="border border-border p-2">
              {p.courseName}
            </td>
            <td className="border border-border p-2">
              <Link
                to="/admin/programs/$programId"
                params={{ programId: p.id }}
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

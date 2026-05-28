import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Programs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Programs</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">+ New program</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New program</DialogTitle>
              <DialogDescription>
                Add a course program that projects can be associated with.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-id">Course ID</Label>
                <Input
                  id="prog-course-id"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  placeholder="e.g., CS-462"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-name">Course name</Label>
                <Input
                  id="prog-course-name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-description">Description</Label>
                <Input
                  id="prog-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={!(courseId && courseName)}>
                  Create program
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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

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
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
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
        <h1 className="font-semibold text-2xl">Programs</h1>
        <Dialog onOpenChange={setOpen} open={open}>
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
            <form className="flex flex-col gap-4" onSubmit={onCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-id">Course ID</Label>
                <Input
                  id="prog-course-id"
                  onChange={(e) => setCourseId(e.target.value)}
                  placeholder="e.g., CS-462"
                  required
                  value={courseId}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-name">Course name</Label>
                <Input
                  id="prog-course-name"
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                  value={courseName}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-description">Description</Label>
                <Input
                  id="prog-description"
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  value={description}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <DialogFooter>
                <Button disabled={!(courseId && courseName)} type="submit">
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
            <td className="border border-border p-2" data-label="Course ID">
              {p.courseId}
            </td>
            <td className="border border-border p-2" data-label="Course name">
              {p.courseName}
            </td>
            <td className="border border-border p-2">
              <Link
                params={{ programId: p.id }}
                to="/admin/programs/$programId"
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

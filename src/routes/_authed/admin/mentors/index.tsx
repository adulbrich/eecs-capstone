import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminTable } from "#/components/admin-table";
import { EmptyState } from "#/components/empty-state";
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
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { listMentors, setUserMentorStatus } from "#/server/users";

export const Route = createFileRoute("/_authed/admin/mentors/")({
  head: () => ({ meta: [{ title: pageTitle("Mentors") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => await listMentors(),
  component: MentorsAdmin,
});

function MentorRow({
  mentor,
}: {
  mentor: {
    affiliation: string | null;
    email: string;
    id: string;
    mentorTeamCount: number;
    name: string | null;
  };
}) {
  const router = useRouter();
  const [count, setCount] = useState(mentor.mentorTeamCount);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(wantsToMentor: boolean) {
    setSaving(true);
    setError(null);
    try {
      await setUserMentorStatus({
        data: { userId: mentor.id, wantsToMentor, mentorTeamCount: count },
      });
      router.invalidate();
    } catch (err) {
      setError((err as Error).message || "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td className="border border-border p-2" data-label="Name">
        {mentor.name ?? "(none)"}
      </td>
      <td className="border border-border p-2" data-label="Affiliation">
        {mentor.affiliation ?? "(none)"}
      </td>
      <td className="border border-border p-2" data-label="Email">
        {mentor.email}
      </td>
      <td className="border border-border p-2" data-label="Teams">
        <Input
          aria-label={`Teams for ${mentor.name ?? mentor.email}`}
          className="w-20"
          max={5}
          min={1}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 1) {
              setCount(1);
            } else if (n > 5) {
              setCount(5);
            }
          }}
          onChange={(e) => setCount(Number(e.target.value))}
          type="number"
          value={count}
        />
      </td>
      <td className="border border-border p-2">
        <div className="flex gap-2">
          <Button
            disabled={saving}
            onClick={() => save(true)}
            size="sm"
            variant="outline"
          >
            Save
          </Button>
          <Button
            disabled={saving}
            onClick={() => save(false)}
            size="sm"
            variant="outline"
          >
            Remove
          </Button>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </td>
    </tr>
  );
}

function MentorsAdmin() {
  const { rows } = Route.useLoaderData();

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
            <BreadcrumbPage>Mentors</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Mentors</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Users who have volunteered to mentor a team. Adjust their team capacity
        or remove them.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No mentors yet.</EmptyState>
      ) : (
        <div className="mt-4">
          <AdminTable columns={["Name", "Affiliation", "Email", "Teams", ""]}>
            {rows.map((m) => (
              <MentorRow key={m.id} mentor={m} />
            ))}
          </AdminTable>
        </div>
      )}
    </div>
  );
}

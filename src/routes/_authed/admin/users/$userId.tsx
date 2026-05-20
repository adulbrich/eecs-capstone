import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { BanForm } from "#/components/ban-form";
import { RoleSelect } from "#/components/role-select";
import { getSession } from "#/lib/auth-guards";
import { getUser } from "#/server/users";

type Role = "user" | "instructor" | "admin";

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/admin" });
    return { actorId: session.user.id };
  },
  loader: async ({ params }) => {
    return await getUser({ data: { id: params.userId } });
  },
  component: UserDetail,
});

function UserDetail() {
  const router = useRouter();
  const { user, projectCount, recentProjects, bookmarkCount } =
    Route.useLoaderData();
  const { actorId } = Route.useRouteContext();
  const isSelf = actorId === user.id;

  function onChanged() {
    void router.invalidate();
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{user.name ?? user.email}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
      {isSelf && (
        <p className="mt-1 text-xs text-muted-foreground">
          This is you. Role and ban controls are disabled.
        </p>
      )}

      <section className="mt-6 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Role</p>
          <p className="mt-1 font-medium">{user.role}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Projects</p>
          <p className="mt-1 font-medium">{projectCount}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Bookmarks</p>
          <p className="mt-1 font-medium">{bookmarkCount}</p>
        </div>
      </section>

      {user.affiliation && (
        <p className="mt-4 text-sm">
          <span className="text-muted-foreground">Affiliation: </span>
          {user.affiliation}
        </p>
      )}
      {user.linkedin && (
        <p className="text-sm">
          <span className="text-muted-foreground">LinkedIn: </span>
          <a href={user.linkedin}>{user.linkedin}</a>
        </p>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">Joined: </span>
        {new Date(user.createdAt).toLocaleDateString()}
      </p>

      {!isSelf && (
        <RoleSelect
          userId={user.id}
          initialRole={user.role as Role}
          onChanged={onChanged}
        />
      )}

      {!isSelf && (
        <BanForm
          userId={user.id}
          banned={user.banned ?? false}
          banReason={user.banReason ?? null}
          banExpires={user.banExpires ?? null}
          onChanged={onChanged}
        />
      )}

      <section className="mt-8">
        <h2 className="font-medium text-sm">Recent projects</h2>
        {recentProjects.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {recentProjects.map((p) => (
              <li key={p.id}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="text-sm"
                >
                  {p.title}
                </Link>{" "}
                <span className="text-xs text-muted-foreground">
                  ({p.status as string})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

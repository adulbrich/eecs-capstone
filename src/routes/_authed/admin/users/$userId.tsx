import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { BanForm } from "#/components/ban-form";
import { RoleSelect } from "#/components/role-select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getUser } from "#/server/users";

type Role = "user" | "instructor" | "admin";

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  head: () => ({ meta: [{ title: pageTitle("Manage User") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (session.user.role !== "admin") {
      throw redirect({ to: "/admin" });
    }
    return { actorId: session.user.id };
  },
  loader: async ({ params }) => await getUser({ data: { id: params.userId } }),
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
              <Link to="/admin/users">Users</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{user.name ?? user.email}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">{user.name ?? user.email}</h1>
      <p className="mt-1 text-muted-foreground text-sm">{user.email}</p>
      {isSelf && (
        <p className="mt-1 text-muted-foreground text-xs">
          This is you. Role and ban controls are disabled.
        </p>
      )}

      <section className="mt-6 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border border-border p-3">
          <p className="text-muted-foreground text-xs">Role</p>
          <p className="mt-1 font-medium">{user.role}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-muted-foreground text-xs">Projects</p>
          <p className="mt-1 font-medium">{projectCount}</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-muted-foreground text-xs">Bookmarks</p>
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
          initialRole={user.role as Role}
          onChanged={onChanged}
          userId={user.id}
        />
      )}

      {!isSelf && (
        <BanForm
          banExpires={user.banExpires ?? null}
          banned={user.banned ?? false}
          banReason={user.banReason ?? null}
          onChanged={onChanged}
          userId={user.id}
        />
      )}

      <section className="mt-8">
        <h2 className="font-medium text-sm">Recent projects</h2>
        {recentProjects.length === 0 ? (
          <p className="mt-2 text-muted-foreground text-sm">None.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {recentProjects.map((p) => (
              <li key={p.id}>
                <Link
                  className="text-sm"
                  params={{ projectId: p.id }}
                  to="/projects/$projectId"
                >
                  {p.title}
                </Link>{" "}
                <span className="text-muted-foreground text-xs">
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

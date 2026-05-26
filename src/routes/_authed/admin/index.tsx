import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BookOpen, FolderKanban, Package, Tag, Users } from "lucide-react";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getAdminStats } from "#/server/admin";

export const Route = createFileRoute("/_authed/admin/")({
  head: () => ({ meta: [{ title: pageTitle("Admin") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
    return { role: session.user.role as "admin" | "instructor" };
  },
  loader: async () => getAdminStats(),
  component: AdminHome,
});

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

type NavCard = {
  to: string;
  icon: React.ElementType;
  label: string;
  description: string;
};

function NavCard({ to, icon: Icon, label, description }: NavCard) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-secondary"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

function AdminHome() {
  const { total, published, submitted, userTotal } = Route.useLoaderData();
  const { role } = Route.useRouteContext();
  const isAdmin = role === "admin";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Overview
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total projects" value={total} />
          <StatCard label="Published" value={published} />
          <StatCard label="Awaiting review" value={submitted} />
          {isAdmin && <StatCard label="Users" value={userTotal} />}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Manage
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <NavCard
            to="/admin/projects"
            icon={FolderKanban}
            label="Projects"
            description="Review, approve, and manage all projects"
          />
          <NavCard
            to="/admin/categories"
            icon={Tag}
            label="Categories"
            description="Add and edit project category tags"
          />
          <NavCard
            to="/admin/programs"
            icon={BookOpen}
            label="Programs"
            description="Manage course programs and instructors"
          />
          <NavCard
            to="/admin/inventory"
            icon={Package}
            label="Inventory"
            description="Add items, review requests, manage checkouts"
          />
          {isAdmin && (
            <NavCard
              to="/admin/users"
              icon={Users}
              label="Users"
              description="Manage roles, bans, and accounts"
            />
          )}
        </div>
      </section>
    </div>
  );
}

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  FolderKanban,
  Handshake,
  Package,
  Tag,
  Users,
} from "lucide-react";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { getAdminStats } from "#/server/admin";

export const Route = createFileRoute("/_authed/admin/")({
  head: () => ({ meta: [{ title: pageTitle("Admin") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
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
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 font-semibold text-2xl tabular-nums">{value}</p>
    </div>
  );
}

// A count box that turns into a colored, clickable alert when it has something
// awaiting action (styled with the same tokens as the "submitted" status
// badge). The typed Link stays at each call site; only the inner content and
// styling are shared, so route/search validation is preserved.
const ALERT_CARD_CLASS =
  "rounded-lg border p-4 transition-shadow hover:shadow-md";
const ALERT_CARD_STYLE = {
  backgroundColor: "var(--status-info-bg)",
  borderColor: "var(--status-info)",
};
const ALERT_TEXT_STYLE = { color: "var(--status-info)" };

function AlertCardBody({ label, value }: { label: string; value: number }) {
  return (
    <>
      <p className="flex items-center gap-1 text-sm" style={ALERT_TEXT_STYLE}>
        {label}
        <ArrowRight className="h-3.5 w-3.5" />
      </p>
      <p
        className="mt-1 font-semibold text-2xl tabular-nums"
        style={ALERT_TEXT_STYLE}
      >
        {value}
      </p>
    </>
  );
}

interface NavCard {
  description: string;
  icon: React.ElementType;
  label: string;
  to: string;
}

function NavCard({ to, icon: Icon, label, description }: NavCard) {
  return (
    <Link
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-secondary"
      to={to}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
      </div>
    </Link>
  );
}

function AdminHome() {
  const { total, published, submitted, userTotal, pendingRequests } =
    Route.useLoaderData();
  const { role } = Route.useRouteContext();
  const isAdmin = role === "admin";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Admin</h1>

      <section className="mt-6">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Overview
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Total projects" value={total} />
          <StatCard label="Published" value={published} />
          {isAdmin && <StatCard label="Users" value={userTotal} />}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {submitted > 0 ? (
            <Link
              className={ALERT_CARD_CLASS}
              search={{
                includeSoftDeleted: false,
                program: null,
                status: "submitted",
              }}
              style={ALERT_CARD_STYLE}
              to="/admin/projects"
            >
              <AlertCardBody label="Awaiting review" value={submitted} />
            </Link>
          ) : (
            <StatCard label="Awaiting review" value={submitted} />
          )}
          {pendingRequests > 0 ? (
            <Link
              className={ALERT_CARD_CLASS}
              search={{ tab: "pending" }}
              style={ALERT_CARD_STYLE}
              to="/admin/inventory/requests"
            >
              <AlertCardBody
                label="Inventory requests"
                value={pendingRequests}
              />
            </Link>
          ) : (
            <StatCard label="Inventory requests" value={pendingRequests} />
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Manage
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <NavCard
            description="Review, approve, and manage all projects"
            icon={FolderKanban}
            label="Projects"
            to="/admin/projects"
          />
          <NavCard
            description="Add and edit project category tags"
            icon={Tag}
            label="Categories"
            to="/admin/categories"
          />
          <NavCard
            description="Manage course programs and instructors"
            icon={BookOpen}
            label="Programs"
            to="/admin/programs"
          />
          <NavCard
            description="Add items, review requests, manage checkouts"
            icon={Package}
            label="Inventory"
            to="/admin/inventory"
          />
          <NavCard
            description="See who volunteered to mentor and set capacity"
            icon={Handshake}
            label="Mentors"
            to="/admin/mentors"
          />
          {isAdmin && (
            <NavCard
              description="Manage roles, bans, and accounts"
              icon={Users}
              label="Users"
              to="/admin/users"
            />
          )}
        </div>
      </section>
    </div>
  );
}

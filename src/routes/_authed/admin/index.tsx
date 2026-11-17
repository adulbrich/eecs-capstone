import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChartLine,
  FolderKanban,
  Handshake,
  Inbox,
  Package,
  Shuffle,
  Tag,
  Users,
} from "lucide-react";
import { useId } from "react";
import { Card } from "#/components/ui/card";
import { requireStaff } from "#/lib/access-denied";
import { pageTitle } from "#/lib/page-title";
import { isAdmin } from "#/lib/viewer";
import { getAdminStats } from "#/server/admin";

export const Route = createFileRoute("/_authed/admin/")({
  head: () => ({ meta: [{ title: pageTitle("Admin") }] }),
  beforeLoad: ({ context }) => {
    requireStaff(context.user);
  },
  loader: async () => getAdminStats(),
  component: AdminHome,
});

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
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
        className="mt-1 text-2xl font-semibold tabular-nums"
        style={ALERT_TEXT_STYLE}
      >
        {value}
      </p>
    </>
  );
}

interface HubLink {
  adminOnly?: boolean;
  description: string;
  icon: React.ElementType;
  label: string;
  to: string;
}

interface HubGroup {
  label: string;
  links: HubLink[];
}

// Grouped by the work, not by the table: a term's project pipeline first,
// then the shared inventory, then the setup that changes once a term, then
// the site-wide reports and accounts. From `xl` the four groups sit in one
// row, which is why this page widens to `max-w-7xl` there (UI-CONVENTIONS,
// "Mobile-first layout").
const HUB_GROUPS: HubGroup[] = [
  {
    label: "Projects",
    links: [
      {
        description: "Review, approve, and manage all projects",
        icon: FolderKanban,
        label: "Projects",
        to: "/admin/projects",
      },
      {
        description: "Place students on project teams from their bids",
        icon: Shuffle,
        label: "Placement",
        to: "/admin/placement",
      },
      {
        description: "See who volunteered to mentor and set capacity",
        icon: Handshake,
        label: "Mentors",
        to: "/admin/mentors",
      },
    ],
  },
  {
    label: "Inventory",
    links: [
      {
        description: "Add items and manage checkouts",
        icon: Package,
        label: "Items",
        to: "/admin/inventory",
      },
      {
        description: "Approve and hand out requested items",
        icon: Inbox,
        label: "Request queue",
        to: "/admin/inventory/requests",
      },
    ],
  },
  {
    label: "Setup",
    links: [
      {
        description: "Manage course programs and instructors",
        icon: BookOpen,
        label: "Programs",
        to: "/admin/programs",
      },
      {
        description: "Add and edit project category tags",
        icon: Tag,
        label: "Categories",
        to: "/admin/categories",
      },
    ],
  },
  {
    label: "Site",
    links: [
      {
        description: "Counts, waits and flows over the app's own data",
        icon: BarChart3,
        label: "Analytics",
        to: "/admin/analytics",
      },
      {
        description: "Page views and visits on the public pages",
        icon: ChartLine,
        label: "Traffic",
        to: "/admin/traffic",
      },
      {
        adminOnly: true,
        description: "Manage roles, bans, and accounts",
        icon: Users,
        label: "Users",
        to: "/admin/users",
      },
    ],
  },
];

function HubGroupPanel({ group }: { group: HubGroup }) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} asChild className="overflow-hidden">
      <section>
        <h2
          className="text-muted-foreground border-b px-4 py-2 text-xs font-medium tracking-wide uppercase"
          id={headingId}
        >
          {group.label}
        </h2>
        <ul className="divide-y">
          {group.links.map(({ to, icon: Icon, label, description }) => (
            <li key={to}>
              <Link
                className="hover:bg-secondary flex items-start gap-3 px-4 py-3 transition-colors"
                to={to}
              >
                <Icon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {description}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}

function AdminHome() {
  const { submitted, pendingRequests } = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const viewerIsAdmin = isAdmin(user);
  const groups = HUB_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => viewerIsAdmin || !link.adminOnly),
  })).filter((group) => group.links.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8 xl:max-w-7xl">
      <h1 className="text-2xl font-semibold">Admin</h1>

      {/* A work queue, not a statistic: the two cards turn coloured and link
          into a pre-filtered list when non-zero. The overview counts that
          used to sit above them moved to /admin/analytics, where a date
          range and a program selector make them mean something (#34). */}
      <section aria-labelledby="admin-attention" className="mt-6">
        <h2 className="sr-only" id="admin-attention">
          Needs attention
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {submitted > 0 ? (
            <Link
              className={ALERT_CARD_CLASS}
              search={{
                includeSoftDeleted: false,
                program: null,
                status: ["submitted"],
              }}
              style={ALERT_CARD_STYLE}
              to="/admin/projects"
            >
              <AlertCardBody
                label="Projects awaiting review"
                value={submitted}
              />
            </Link>
          ) : (
            <StatCard label="Projects awaiting review" value={submitted} />
          )}
          {pendingRequests > 0 ? (
            <Link
              className={ALERT_CARD_CLASS}
              search={{ status: "pending" }}
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

      <div className="mt-8 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <HubGroupPanel group={group} key={group.label} />
        ))}
      </div>
    </div>
  );
}

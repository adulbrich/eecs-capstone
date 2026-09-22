import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { BanForm } from "#/components/ban-form";
import { LocalTime } from "#/components/local-time";
import { RoleSelect } from "#/components/role-select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { AI_FEATURE_NOUN } from "#/lib/ai-review-limits";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { isAdmin } from "#/lib/viewer";
import type { UserRole } from "#/lib/vocabularies";
import { getUser } from "#/server/users";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  onid: "ONID",
  google: "Google",
  linkedin: "LinkedIn",
  discord: "Discord",
};

const providerLabel = (id: string) => PROVIDER_LABELS[id] ?? id;

/**
 * How this person can sign in. An emailed code needs no `account` row, so it
 * is listed for everyone rather than read from one, and a `credential` row is
 * left out: production still holds the ones written before #576, and none of
 * them signs anybody in.
 */
const signInMethods = (providers: string[]) => [
  "Emailed code",
  ...providers.filter((id) => id !== "credential").map(providerLabel),
];

export const Route = createFileRoute("/_authed/admin/users/$userId")({
  head: () => ({ meta: [{ title: pageTitle("Manage User") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isAdmin(session.user)) {
      throw redirect({ to: "/admin" });
    }
    return { actorId: session.user.id };
  },
  loader: async ({ params }) => await getUser({ data: { id: params.userId } }),
  component: UserDetail,
});

function UserDetail() {
  const router = useRouter();
  const {
    user,
    projectCount,
    recentProjects,
    bookmarkCount,
    providers,
    aiUsage,
  } = Route.useLoaderData();
  const { actorId } = Route.useRouteContext();
  const isSelf = actorId === user.id;

  async function onChanged() {
    await router.invalidate();
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
          <a
            className="break-all text-brand-dark underline"
            href={user.linkedin}
          >
            {user.linkedin}
          </a>
        </p>
      )}
      {user.wantsToMentor && (
        <p className="text-sm">
          <span className="text-muted-foreground">Mentor: </span>
          yes ({user.mentorTeamCount ?? 1} teams)
        </p>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">Sign-in: </span>
        {signInMethods(providers).join(", ")}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">Joined: </span>
        <LocalTime dateOnly value={user.createdAt} />
      </p>

      {!isSelf && (
        <RoleSelect
          email={user.email}
          initialRole={user.role as UserRole}
          onChanged={onChanged}
          userId={user.id}
        />
      )}

      {!isSelf && (
        <BanForm
          banExpires={user.banExpires ?? null}
          banned={user.banned ?? false}
          banReason={user.banReason ?? null}
          email={user.email}
          onChanged={onChanged}
          userId={user.id}
        />
      )}

      <section className="mt-8">
        <h2 className="font-medium text-sm">AI usage</h2>
        {/*
          All time, the same window the AI calls column on /admin/users
          counts, and no cost in dollars: no per-model price exists in this
          repo and an invented one is a number nobody can defend (#413). The
          feature names come from the limiter's own vocabulary, so this page
          cannot drift from what a refusal tells the person.
        */}
        <p className="mt-2 text-muted-foreground text-xs">
          All time. The hourly and daily limits are shown to the person when a
          call is refused.
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {aiUsage.byFeature.map((row) => (
            <div key={row.feature}>
              {/*
                The limiter's own words, cased for a label rather than
                reworded: `AI_FEATURE_NOUN` is written for the middle of a
                sentence a refusal shows the person, and rewriting it here is
                how this page would drift from what they were told.
              */}
              <dt className="text-muted-foreground text-xs first-letter:uppercase">
                {AI_FEATURE_NOUN[row.feature]}
              </dt>
              <dd className="font-medium">{row.calls}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground text-xs">Input tokens</dt>
            <dd className="font-medium">
              {aiUsage.inputTokens.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Reasoning tokens</dt>
            <dd className="font-medium">
              {aiUsage.reasoningTokens.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Output tokens</dt>
            <dd className="font-medium">
              {aiUsage.outputTokens.toLocaleString()}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Last call: </span>
          {aiUsage.lastCallAt ? (
            <LocalTime dateOnly value={aiUsage.lastCallAt} />
          ) : (
            "no AI calls yet"
          )}
        </p>
      </section>

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

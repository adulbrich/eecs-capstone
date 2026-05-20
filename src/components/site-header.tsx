import { Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";
import { InstitutionLogo } from "./institution-logo";
import { NotificationBell } from "./notification-bell";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = !!session?.user;
  const role =
    (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isStaff = role === "admin" || role === "instructor";

  return (
    <header
      className="border-b border-[var(--line)]"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(8px)" }}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        <Link to="/">
          <InstitutionLogo />
        </Link>

        <nav className="flex flex-1 items-center gap-4 text-sm">
          <Link to="/projects" className="nav-link">
            Projects
          </Link>
          {signedIn && (
            <>
              <Link to="/my/projects" className="nav-link">
                My projects
              </Link>
              <Link to="/my/bookmarks" className="nav-link">
                Bookmarks
              </Link>
              <Link to="/projects/new" className="nav-link">
                New project
              </Link>
            </>
          )}
          {isStaff && (
            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {isPending ? (
            <div className="h-8 w-24 animate-pulse rounded bg-[var(--surface-sunken)]" />
          ) : signedIn ? (
            <SignedIn
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
            />
          ) : (
            <SignedOut />
          )}
        </div>
      </div>
    </header>
  );
}

function SignedOut() {
  return (
    <>
      <Link to="/sign-in" className="nav-link text-sm">
        Sign in
      </Link>
      <Link
        to="/sign-up"
        className="bg-brand hover:bg-brand-dark rounded px-3 py-1.5 text-sm font-medium text-white"
      >
        Sign up
      </Link>
    </>
  );
}

function SignedIn({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string;
  image: string | null | undefined;
}) {
  const resolvedImage = getPublicUrl(image);
  return (
    <>
      <NotificationBell />
      <Link to="/profile" className="flex items-center gap-2 hover:underline">
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-xs font-medium">
            {(name ?? email).charAt(0).toUpperCase()}
          </div>
        )}
        <span>{name ?? email}</span>
      </Link>
      <button
        type="button"
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/sign-in";
        }}
        className="rounded border border-[var(--line)] px-3 py-1.5 text-sm hover:bg-[var(--surface-sunken)]"
      >
        Sign out
      </button>
    </>
  );
}

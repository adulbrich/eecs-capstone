import { Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";
import { NotificationBell } from "./notification-bell";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = !!session?.user;
  const role =
    (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isStaff = role === "admin" || role === "instructor";

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        <Link to="/" className="text-sm font-semibold">
          CS Capstone
        </Link>

        <nav className="flex flex-1 items-center gap-4 text-sm">
          <Link to="/projects" className="hover:underline">
            Projects
          </Link>
          {signedIn && (
            <>
              <Link to="/my/projects" className="hover:underline">
                My projects
              </Link>
              <Link to="/my/bookmarks" className="hover:underline">
                Bookmarks
              </Link>
              <Link to="/projects/new" className="hover:underline">
                New project
              </Link>
            </>
          )}
          {isStaff && (
            <Link to="/admin" className="hover:underline">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {isPending ? (
            <div className="h-8 w-24 animate-pulse bg-neutral-100 dark:bg-neutral-800" />
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
      <Link to="/sign-in" className="hover:underline">
        Sign in
      </Link>
      <Link
        to="/sign-up"
        className="bg-black px-3 py-1.5 text-white hover:bg-neutral-800"
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
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium dark:bg-neutral-700">
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
        className="border border-neutral-300 px-3 py-1.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Sign out
      </button>
    </>
  );
}

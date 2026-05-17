import { Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link to="/" className="text-sm font-semibold">
          CS Capstone
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {isPending ? (
            <div className="h-8 w-24 animate-pulse bg-neutral-100 dark:bg-neutral-800" />
          ) : session?.user ? (
            <SignedIn
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
              role={(session.user as { role?: string | null }).role ?? null}
            />
          ) : (
            <SignedOut />
          )}
        </nav>
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
  role,
}: {
  name: string | null;
  email: string;
  image: string | null | undefined;
  role: string | null;
}) {
  const isStaff = role === "admin" || role === "instructor";
  return (
    <>
      {isStaff && (
        <Link to="/admin" className="hover:underline">
          Admin
        </Link>
      )}
      <Link to="/profile" className="flex items-center gap-2 hover:underline">
        {image ? (
          <img
            src={image}
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

import { authClient } from "#/lib/auth-client";

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <div className="h-8 w-8 animate-pulse bg-secondary" />;
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        {session.user.image ? (
          <img alt="" className="h-8 w-8" src={session.user.image} />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center bg-secondary">
            <span className="font-medium text-muted-foreground text-xs">
              {session.user.name?.charAt(0).toUpperCase() || "U"}
            </span>
          </div>
        )}
        <button
          className="h-9 flex-1 border border-border bg-card px-4 font-medium text-card-foreground text-sm transition-colors hover:bg-secondary"
          onClick={() => {
            void authClient.signOut();
          }}
          type="button"
        >
          Sign out
        </button>
      </div>
    );
  }

  return null;
}
